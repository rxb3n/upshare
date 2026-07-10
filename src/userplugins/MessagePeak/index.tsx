/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */


import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    MessageStore,
    Parser,
    Tooltip,
    useStateFromStores,
    UserStore,
} from "@webpack/common";

const logger = new Logger("MessagePeek");

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

            content = `☎ Call ended after ${durationText}`;
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
            : lastMessage.author?.globalName || lastMessage.author?.username || "Unknown User";

    const tooltipText =
        content.length > charLimit
            ? Parser.parse(content.slice(0, charLimit).trim() + "…")
            : Parser.parse(content);

    const previewText =
        content.length > 48
            ? content.slice(0, 48).trim() + "…"
            : content;

    return (
        <Tooltip text={tooltipText}>
            {({ onMouseEnter, onMouseLeave }) => (
                <div
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    style={{
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        fontSize: "12px",
                        lineHeight: "16px",
                        color: "var(--text-normal)",
                    }}
                >
                    {settings.store.showAuthor && !isCallActivity && (
                        <span style={{ opacity: 0.75 }}>{authorName}: </span>
                    )}
                    {previewText}
                </div>
            )}
        </Tooltip>
    );
}

export default definePlugin({
    name: "MessagePeek",
    description: "last dm chat",
    authors: [{ name: "Kirk", id: 0n }],
    settings,

    start() {
        const style = document.createElement("style");
        style.id = "MessagePeekStyles";
        style.textContent = css;
        document.head.appendChild(style);

        if (!settings.store.showInDMs) return;

        const limit = settings.store.preloadLimit;
        if (limit <= 0) return;

        try {
            const channels = ChannelStore.getSortedPrivateChannels?.() ?? [];
            channels.slice(0, limit).forEach((channel: any) => {
                if (!MessageStore.getMessages(channel.id)?.last()) {
                    ChannelActions.preload(null, channel.id);
                }
            });
        } catch (e) {
            logger.error("Failed to preload DM channels", e);
        }
    },

    stop() {
        document.getElementById("MessagePeekStyles")?.remove();
    },

    patches: [
        {
            // Anchored to the dev-only invariant string inside the DM row renderer (eH).
            find: '"PrivateChannel.renderAvatar: Invalid prop configuration',
            replacement: {
                // Stack our preview alongside the existing subText (status/activity/group count)
                // instead of only falling back when subText is null — Discord shows subText
                // even when a status/activity is present, so `??` alone would hide our preview.
                match: /subText:(\i\.isSystemDM\(\).+?:null),name:/,
                replace: (_, subText: string) =>
                    `subText:[${subText},$self.renderMessagePeek(t.id)],name:`
            },
        },
    ],

    renderMessagePeek(channelId?: string) {
        if (!settings.store.showInDMs) return null;
        return <MessagePeek channelId={channelId} />;
    },
});