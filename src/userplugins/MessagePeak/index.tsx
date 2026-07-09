/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { Logger } from "@utils/Logger";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { React, Tooltip, useStateFromStores } from "@webpack/common";

const logger = new Logger("MessagePeek");
const MessageStore = findStoreLazy("MessageStore");
const ChannelStore = findStoreLazy("ChannelStore");
const UserStore = findStoreLazy("UserStore");
const Parser = findByPropsLazy("parseTopic", "parseInlineReply");
const ChannelActions = findByPropsLazy("preload", "fetchChannel");

const settings = definePluginSettings({
    showInDMs: {
        type: OptionType.BOOLEAN,
        description: "Show in DMs",
        default: true
    },
    showAuthor: {
        type: OptionType.BOOLEAN,
        description: "Show author",
        default: true
    },
    showYourselfAsYou: {
        type: OptionType.BOOLEAN,
        description: 'Show your own name as "You"',
        default: true
    },
    preloadLimit: {
        type: OptionType.SLIDER,
        description: "How many DM channels to preload",
        default: 10,
        markers: [0, 5, 10, 20, 30],
        stickToMarkers: false
    },
    tooltipCharacterLimit: {
        type: OptionType.SLIDER,
        description: "Tooltip character limit",
        default: 256,
        markers: [64, 128, 256, 512, 1024],
        stickToMarkers: true
    }
});

const css = `
a[href^="/channels/@me/"] [class^="layout"] {
    min-height: 42px;
    max-height: 50px;
    height: unset;
}
`;

function MessagePeek({ channelId }: { channelId?: string; }) {
    if (!channelId) return null;

    const lastMessage = useStateFromStores([MessageStore], () =>
        MessageStore.getMessages(channelId)?.last()
    );

    if (!lastMessage) return null;

    const attachmentCount = lastMessage.attachments?.length ?? 0;

    let content =
        lastMessage.content ||
        lastMessage.embeds?.[0]?.rawDescription ||
        (lastMessage.stickerItems?.length ? "Sticker" : "") ||
        (attachmentCount ? `${attachmentCount} attachment${attachmentCount > 1 ? "s" : ""}` : "");

    if (!content && lastMessage.type === 3 && lastMessage.call) {
        const ended = !!lastMessage.call.endedTimestamp || !!lastMessage.call.ended_timestamp;
        const rawEndedAt = lastMessage.call.endedTimestamp ?? lastMessage.call.ended_timestamp ?? null;
        const startedAt = new Date(lastMessage.timestamp).getTime();
        const endedAt = rawEndedAt ? new Date(rawEndedAt).getTime() : null;

        if (ended && endedAt && endedAt >= startedAt) {
            const diff = endedAt - startedAt;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(minutes / 60);

            let durationText: string;
            if (hours >= 1) {
                durationText = hours === 1 ? "1 hour" : `${hours} hours`;
            } else if (minutes >= 1) {
                durationText = minutes === 1 ? "1 minute" : `${minutes} minutes`;
            } else {
                durationText = "a few seconds";
            }

            content = `☎  Call ended after ${durationText}`;
        } else {
            content = "Started a call";
        }
    }

    if (!content) return null;

    const charLimit = settings.store.tooltipCharacterLimit;
    const currentUser = UserStore?.getCurrentUser?.();
    const isCurrentUser = currentUser?.id != null && lastMessage.author?.id === currentUser.id;
    const isCallActivity = lastMessage.type === 3 && !!lastMessage.call;

    const authorName =
        isCurrentUser && settings.store.showYourselfAsYou
            ? "You"
            : (lastMessage.author?.globalName || lastMessage.author?.username || "Unknown User");

    const tooltipText =
        content.length > charLimit
            ? Parser.parse(content.slice(0, charLimit).trim() + "…")
            : Parser.parse(content);

    return (
        <div
            style={{
                marginBottom: "2px",
                marginTop: "-2px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
            }}
        >
            <Tooltip text={tooltipText}>
                {tooltipProps => (
                    <div
                        {...tooltipProps}
                        style={{
                            fontSize: "12px",
                            fontWeight: "var(--font-weight-medium)",
                            lineHeight: "16px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                        }}
                    >
                        {settings.store.showAuthor && !isCallActivity ? `${authorName}: ` : null}
                        {Parser.parseInlineReply(content)}
                    </div>
                )}
            </Tooltip>
        </div>
    );
}

const WrappedPeek = ErrorBoundary.wrap((props: { channelId?: string; }) => {
    return <MessagePeek {...props} />;
}, { noop: true });

let styleEl: HTMLStyleElement | null = null;

export default definePlugin({
    name: "MessagePeek",
    description: "last message on dms",
    authors: [{ name: "Kirk", id: 0n }],
    settings,

    patches: [
        {
            find: 'location:"PrivateChannel"',
            replacement: [
                {
                    match: /subText:(.*?)(?=,name:\(0,i\.jsx\)\(g\.A,)/,
                    replace: "subText:$self.renderDmSubText($1,t)"
                }
            ],
            predicate: () => settings.store.showInDMs
        }
    ],

    start() {
        logger.info("start called");
        styleEl = document.createElement("style");
        styleEl.id = "vc-messagepeek-style";
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
        this.preloadDMs();
    },

    stop() {
        styleEl?.remove();
        styleEl = null;
    },

    renderDmSubText(original: React.ReactNode, channel: any) {
        const channelId = channel?.id;

        if (!channelId || !/^\d{17,20}$/.test(String(channelId))) return original;

        return React.createElement(
            React.Fragment,
            null,
            original,
            React.createElement(WrappedPeek, {
                channelId: String(channelId),
                key: `vc-messagepeek-dm-${channelId}`
            })
        );
    },

    preloadDMs() {
        const preload = ChannelActions?.preload;
        if (!preload) {
            logger.warn("no preload action found");
            return;
        }

        const channels = ChannelStore.getSortedPrivateChannels?.() ?? [];
        logger.info("private channels", channels.length);

        channels
            .filter((channel: any) =>
                channel.lastMessageId &&
                !MessageStore.getMessages(channel.id)?.last()
            )
            .slice(0, Math.min(settings.store.preloadLimit, 30))
            .reduce((promise: Promise<void>, channel: any, index: number) => {
                return promise.then(() => new Promise<void>(resolve => {
                    try {
                        preload("@me", channel.id);
                    } catch (e) {
                        logger.warn("preload failed", e);
                    }
                    setTimeout(resolve, 125 + index * 125);
                }));
            }, Promise.resolve());
    }
});