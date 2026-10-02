// Shows the current trip's shared membership without leaving the itinerary.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ChevronDown, Users, X } from "lucide-react";
import { tr } from "../i18n";
import type { Trip } from "../types";

type Props = {
  members: Trip["members"];
  currentUserId: string;
  onViewMembers: () => void;
};

export default function TripMembers({ members, currentUserId, onViewMembers }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 340, maxHeight: 400 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const headingId = useId();

  function positionPanel() {
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    // A body portal and viewport clamping keep the list above maps and inside narrow screens.
    const width = Math.min(340, window.innerWidth - 32);
    const top = Math.max(16, Math.min(anchor.bottom + 10, window.innerHeight - 240));
    setPosition({
      top,
      left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)),
      width,
      maxHeight: Math.min(480, window.innerHeight - top - 16),
    });
  }

  function closeAndFocusTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const isInside = (target: EventTarget | null) => target instanceof Node &&
      (panelRef.current?.contains(target) || triggerRef.current?.contains(target));
    // This is a non-modal dialog: users can leave with Tab or an outside click.
    const dismissOutside = (event: Event) => {
      if (!isInside(event.target)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndFocusTrigger();
      }
    };
    const repositionOnScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) positionPanel();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("resize", positionPanel);
    document.addEventListener("scroll", repositionOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("resize", positionPanel);
      document.removeEventListener("scroll", repositionOnScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="member-preview-trigger"
        aria-label={tr("View trip members")}
        title={tr("View trip members")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (!open) positionPanel();
          setOpen(!open);
        }}
      >
        <span className="member-stack" aria-hidden="true">
          {members.slice(0, 4).map((member, index) => (
            <span key={member.id} className={"avatar tone-" + index}>
              {member.name.slice(0, 1)}
            </span>
          ))}
          {members.length > 4 && <span className="avatar member-overflow">+{members.length - 4}</span>}
          {members.length === 0 && <Users size={20} />}
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={panelRef} id={panelId} className="member-popover" style={position}
          role="dialog" aria-labelledby={headingId}>
          <div className="member-popover-header">
            <div>
              <h2 id={headingId}>{tr("Trip members")}</h2>
              <p>{members.length === 1 ? tr("1 member") : tr("{count} members", { count: members.length })}</p>
            </div>
            <button ref={closeRef} type="button" className="icon-button"
              aria-label={tr("Close member list")} onClick={closeAndFocusTrigger}>
              <X size={18} />
            </button>
          </div>
          {/* Read directly from the live trip snapshot so membership and role changes stay current. */}
          <ul className="member-popover-list">
            {members.map((member, index) => (
              <li key={member.id} className="member-popover-row">
                <span className={"avatar tone-" + (index % 4)} aria-hidden="true">{member.name.slice(0, 1)}</span>
                <div className="member-popover-person">
                  <strong>{member.name}{member.id === currentUserId && <span className="member-self">{tr(" (you)")}</span>}</strong>
                  <small>{member.email}</small>
                  <span className="member-popover-role">{tr(member.role === "owner" ? "Manager" : member.role)}</span>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="member-popover-footer" onClick={() => {
            closeAndFocusTrigger();
            onViewMembers();
          }}>
            {tr("View all members")}<ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>, document.body,
      )}
    </>
  );
}
