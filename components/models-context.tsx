"use client";

import { createContext, useContext } from "react";
import type { ProviderState } from "./ModelPicker";

/**
 * What a message needs to offer "regenerate with another model": the available
 * models, the starred ones, and what to do on a pick.
 *
 * A context rather than props because Message is memoised, and each message in
 * a conversation would otherwise be handed the provider list — a value that
 * changes whenever a fetch lands. Consumers of a context re-render only when it
 * does, and Workspace keeps the value stable between those moments.
 */
export interface ModelsContextValue {
  providers: ProviderState[];
  favorites: string[];
  onToggleFavorite: (provider: string, model: string) => void;
  /** Drop this reply and ask again with the chosen model. */
  onRegenerateWith: (messageId: string, provider: string, model: string) => void;
  onOpenSettings: () => void;
}

export const ModelsContext = createContext<ModelsContextValue | null>(null);

export const useModels = () => useContext(ModelsContext);
