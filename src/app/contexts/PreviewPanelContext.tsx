import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type PreviewType = "backlog" | "wiki" | "minute";
export interface PreviewTarget { type: PreviewType; id: string; }

const Ctx = createContext<{
  target: PreviewTarget | null;
  open: (type: PreviewType, id: string) => void;
  close: () => void;
}>({ target: null, open: () => {}, close: () => {} });

export function PreviewPanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  return (
    <Ctx.Provider value={{
      target,
      open: (type, id) => setTarget({ type, id }),
      close: () => setTarget(null),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePreviewPanel = () => useContext(Ctx);
