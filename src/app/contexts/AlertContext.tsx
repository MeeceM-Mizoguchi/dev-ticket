import { createContext, useContext, useState, type ReactNode } from "react";
import { AlertDialog } from "@/app/components/shared/AlertDialog";

interface AlertState {
  message: string;
  title?: string;
}

const AlertCtx = createContext<{ showAlert: (message: string, title?: string) => void }>({ showAlert: () => {} });
export const useAlert = () => useContext(AlertCtx);

export function AlertProvider({ children }: { children: ReactNode }) {
  const [alertState, setAlertState] = useState<AlertState | null>(null);

  return (
    <AlertCtx.Provider value={{ showAlert: (message, title) => setAlertState({ message, title }) }}>
      {children}
      {alertState && (
        <AlertDialog
          message={alertState.message}
          title={alertState.title}
          onClose={() => setAlertState(null)}
        />
      )}
    </AlertCtx.Provider>
  );
}
