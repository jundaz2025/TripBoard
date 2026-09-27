// Uses a native modal dialog for focus management; the language switch stays reachable in its top layer.
import { translateMessage } from "../i18n";
import { useEffect, useRef } from "react";
import LanguageSwitch from "./LanguageSwitch";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export default function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="modal"
    >
      <div className="modal-heading">
        <div>
          <h2>{translateMessage(title)}</h2>
          {subtitle && <p>{translateMessage(subtitle)}</p>}
        </div>
        <div className="modal-tools">
        <LanguageSwitch />
        <button
          type="button"
          className="icon-button"
          aria-label={translateMessage("Close dialog")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        </div>
      </div>
      {children}
    </dialog>
  );
}
