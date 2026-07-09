/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, showToast, Toasts, UserStore, ChannelStore, GuildStore, RelationshipStore } from "@webpack/common";
import { SettingsPanel } from "./SettingsPanel";

const PresenceStore = findByPropsLazy("getStatus", "isMobileOnline");

const settings = definePluginSettings({
    trackFriends: {
        type: OptionType.BOOLEAN,
        description: "Track all friends (status, messages, typing)",
        default: true,
    },
    trackedUserIds: {
        type: OptionType.STRING,
        description: "Comma-separated list of specific user IDs to track",
        default: "",
        hidden: true, // managed by the settings panel UI
    },
    notifyStatus: {
        type: OptionType.BOOLEAN,
        description: "Notify when a tracked user changes status",
        default: true,
    },
    notifyMessage: {
        type: OptionType.BOOLEAN,
        description: "Notify when a tracked user sends a message",
        default: true,
    },
    notifyTyping: {
        type: OptionType.BOOLEAN,
        description: "Notify when a tracked user starts typing",
        default: false,
    },
});

const lastStatuses: Record<string, string | undefined> = {};

function getTrackedIds(): string[] {
    const ids = new Set<string>();

    if (settings.store.trackFriends) {
        for (const id of RelationshipStore.getFriendIDs()) ids.add(id);
    }

    const raw = settings.store.trackedUserIds.trim();
    if (raw) {
        for (const id of raw.split(",").map(s => s.trim()).filter(Boolean)) {
            ids.add(id);
        }
    }

    return [...ids];
}

function getName(id: string): string {
    return UserStore.getUser(id)?.username ?? id;
}

function onPresenceUpdate(payload: any) {
    if (!settings.store.notifyStatus) return;
    const id = payload?.user?.id;
    if (!id || !getTrackedIds().includes(id)) return;

    if (lastStatuses[id] !== payload.status) {
        lastStatuses[id] = payload.status;
        showToast(`${getName(id)} is now ${payload.status}`, Toasts.Type.MESSAGE);
    }
}

function onMessageCreate(payload: any) {
    if (!settings.store.notifyMessage) return;
    const m = payload?.message;
    const id = m?.author?.id;
    if (!id || !getTrackedIds().includes(id)) return;

    const channel = ChannelStore.getChannel(m.channel_id);
    if (!channel) return;

    let location: string;
    if (channel.guild_id) {
        const guild = GuildStore.getGuild(channel.guild_id);
        location = `${guild?.name ?? "a server"} #${channel.name}`;
    } else if (channel.type === 3) {
        location = "a group DM";
    } else {
        location = "a DM";
    }

    showToast(`${getName(id)} messaged in ${location}`, Toasts.Type.MESSAGE);
}

function onTypingStart(payload: any) {
    if (!settings.store.notifyTyping) return;
    const id = payload?.userId;
    if (!id || !getTrackedIds().includes(id)) return;

    const channel = ChannelStore.getChannel(payload.channelId);
    if (!channel) return;

    let location: string;
    if (channel.guild_id) {
        const guild = GuildStore.getGuild(channel.guild_id);
        location = `${guild?.name ?? "a server"} #${channel.name}`;
    } else if (channel.type === 3) {
        location = "a group DM";
    } else {
        location = "a DM";
    }

    showToast(`${getName(id)} is typing in ${location}`, Toasts.Type.MESSAGE);
}

export default definePlugin({
    name: "UserNotif",
    description: "Shows toast notifications when tracked users change status, send messages, or start typing.",
    authors: [{ name: "Kirk", id: 0n }],
    settings,
    settingsAboutComponent: SettingsPanel,

    start() {
        // Seed initial statuses to avoid false triggers on load
        for (const id of getTrackedIds()) {
            lastStatuses[id] = PresenceStore.getStatus(id);
        }

        FluxDispatcher.subscribe("PRESENCE_UPDATE", onPresenceUpdate);
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.subscribe("TYPING_START", onTypingStart);
    },

    stop() {
        FluxDispatcher.unsubscribe("PRESENCE_UPDATE", onPresenceUpdate);
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.unsubscribe("TYPING_START", onTypingStart);
    },
});