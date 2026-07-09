/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Constants, FluxDispatcher, RelationshipStore } from "@webpack/common";
import { findByPropsLazy } from "@webpack";

const ChannelStore = findByPropsLazy("getChannel", "getDMFromUserId");
const PrivateChannelActions = findByPropsLazy("closePrivateChannel");

export default definePlugin({
    name: "IgnoredUsersTab",
    description: "Moves ignored users into their own 'Ignored' tab, hides them from Online/All, and closes DMs from ignored users.",
    authors: [{ name: "Kirk", id: 0n }],

    _messageHandler: null as null | ((payload: any) => void),

    patches: [
        // ── 1. Tab bar ────────────────────────────────────────────────────────
        {
            find: ".b9w3bO),className:",
            replacement: {
                match: /,(\{id:(\i\.\i)\.PENDING,show:.+?className:(\i\.\i)(?=\},\{id:))/,
                replace: (match, pendingEntry, sectionTypes, className) =>
                    `,{id:${sectionTypes}.IGNORED,show:true,className:${className},content:"Ignored"}${match}`
            }
        },

        // ── 2. Section count header ───────────────────────────────────────────
        {
            find: ".rHRrhC",
            replacement: {
                match: /case (\i\.\i)\.SUGGESTIONS:return (\i)\.intl\.formatToPlainString\((\i)\["DYMZ\/p"\],\{count:(\i)\.toString\(\)\}\)/,
                replace: 'case $1.IGNORED:return"Ignored \u2014 "+$self.getIgnoredCount();case $1.SUGGESTIONS:return $2.intl.formatToPlainString($3["DYMZ/p"],{count:$4.toString()})'
            }
        },

        // ── 3. Empty state ────────────────────────────────────────────────────
        {
            find: "FriendsEmptyState: Invalid empty state",
            replacement: {
                match: /(case (\i\.\i)\.ONLINE:return (\i)\.SECTION_ONLINE)/,
                replace: "case $2.IGNORED:return $3.SECTION_ONLINE;$1"
            }
        },

        // ── 4-6. FriendsStore filter ──────────────────────────────────────────
        {
            find: '"FriendsStore"',
            replacement: [
                {
                    match: /case (\i\.\i)\.SUGGESTIONS:return 99===(\i)\.type/,
                    replace: "case $1.IGNORED:return $2.ignoredUser===true;case $1.SUGGESTIONS:return 99===$2.type"
                },
                {
                    match: /case (\i\.\i)\.ONLINE:return (\i)\.type===(\i\.\i)\.FRIEND&&\2\.status!==(\i\.\i)\.OFFLINE/,
                    replace: "case $1.ONLINE:return $2.type===$3.FRIEND&&$2.status!==$4.OFFLINE&&!$2.ignoredUser"
                },
                {
                    match: /case (\i\.\i)\.ALL:default:return (\i)\.type===(\i\.\i)\.FRIEND/,
                    replace: "case $1.ALL:default:return $2.type===$3.FRIEND&&!$2.ignoredUser"
                },
            ]
        },
    ],

    getIgnoredCount(): number {
        return RelationshipStore.getIgnoredIDs().length;
    },

    isIgnoredDM(channelId: string): boolean {
        try {
            const channel = ChannelStore.getChannel(channelId);
            if (!channel || channel.type !== 1) return false;
            const recipientId: string | undefined = channel.recipients?.[0];
            return !!recipientId && RelationshipStore.isIgnored(recipientId);
        } catch { return false; }
    },

    start() {
        Constants.FriendsSections.IGNORED = "IGNORED";

        this._messageHandler = ({ message }: any) => {
            if (!message?.channel_id) return;
            if (!this.isIgnoredDM(message.channel_id)) return;
            // Close the DM so it doesn't stay at the top of the list
            PrivateChannelActions.closePrivateChannel(message.channel_id);
        };

        FluxDispatcher.subscribe("MESSAGE_CREATE", this._messageHandler);
    },

    stop() {
        delete Constants.FriendsSections.IGNORED;
        if (this._messageHandler) {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", this._messageHandler);
            this._messageHandler = null;
        }
    }
});