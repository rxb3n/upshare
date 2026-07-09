/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useSettings } from "@api/Settings";
import { Button, Forms, TextInput } from "@webpack/common";
import { useState } from "@webpack/common";
import { UserStore } from "@webpack/common";
import { showToast, Toasts } from "@webpack/common";

export function SettingsPanel() {
    const settings = useSettings(["plugins.UserNotif.trackedUserIds"]);
    const pluginSettings = settings.plugins.UserNotif;

    const [inputId, setInputId] = useState("");

    const trackedIds: string[] = pluginSettings.trackedUserIds
        ? pluginSettings.trackedUserIds.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];

    function addId() {
        const trimmed = inputId.trim();
        if (!trimmed) {
            showToast("Please enter a user ID", Toasts.Type.FAILURE);
            return;
        }
        if (trackedIds.includes(trimmed)) {
            showToast("User ID already tracked", Toasts.Type.FAILURE);
            return;
        }
        pluginSettings.trackedUserIds = [...trackedIds, trimmed].join(",");
        setInputId("");
        showToast("User ID added!", Toasts.Type.SUCCESS);
    }

    function removeId(id: string) {
        pluginSettings.trackedUserIds = trackedIds.filter(i => i !== id).join(",");
        showToast("User ID removed", Toasts.Type.SUCCESS);
    }

    return (
        <section>
            <Forms.FormTitle tag="h3">Add Specific User IDs</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 8 }}>
                These are tracked in addition to friends (if "Track Friends" is enabled above).
                Enable Developer Mode in Discord settings, then right-click a user → Copy User ID.
            </Forms.FormText>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <TextInput
                    placeholder="Enter user ID..."
                    value={inputId}
                    onChange={setInputId}
                    style={{ flex: 1 }}
                />
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={addId}
                >
                    Add
                </Button>
            </div>

            {trackedIds.length > 0 && (
                <>
                    <Forms.FormTitle tag="h3">Tracked User IDs</Forms.FormTitle>
                    {trackedIds.map(id => {
                        const user = UserStore.getUser(id);
                        const label = user ? `${user.username} (${id})` : id;

                        return (
                            <div
                                key={id}
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "6px 0",
                                    borderBottom: "1px solid var(--background-modifier-accent)",
                                }}
                            >
                                <Forms.FormText>{label}</Forms.FormText>
                                <Button
                                    color={Button.Colors.RED}
                                    size={Button.Sizes.SMALL}
                                    onClick={() => removeId(id)}
                                >
                                    Remove
                                </Button>
                            </div>
                        );
                    })}
                </>
            )}
        </section>
    );
}