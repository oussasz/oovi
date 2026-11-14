"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { BrandIcon } from "@/components/BrandIcon";
import type { Opt } from "@/lib/pilot-form";

/**
 * A dropdown whose choices carry a real logo. Works with the mouse, touch and the keyboard
 * (arrows, Home/End, Enter or Space, Escape, and typing the first letter), and tells screen readers
 * what it is (the "select-only combobox" pattern). The chosen value is sent as a hidden field.
 */
export function IconSelect({
  name,
  legend,
  options,
  required = false,
  placeholder = "Choose one",
  onChange,
}: {
  name: string;
  legend: string;
  options: Opt[];
  required?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  const openList = () => {
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  };
  const choose = (v: string) => {
    setValue(v);
    onChange?.(v);
    setOpen(false);
    btn.current?.focus();
  };

  // Click or touch outside closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
    };
  }, [open]);

  // Keep the highlighted choice in view.
  useEffect(() => {
    if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKey = (e: KeyboardEvent) => {
    const n = options.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (open) setActive((a) => (a + 1) % n);
        else openList();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) setActive((a) => (a - 1 + n) % n);
        else openList();
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActive(n - 1);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) choose(options[active]!.value);
        else openList();
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
          if (i >= 0) {
            if (!open) setOpen(true);
            setActive(i);
          }
        }
    }
  };

  return (
    <fieldset className="pf-group">
      <legend id={`${id}-legend`}>
        {legend}
        {required ? <span className="pf-req"> *</span> : <span className="pf-opt"> (optional)</span>}
      </legend>
      <div className="pf-select" ref={root}>
        <button
          ref={btn}
          id={`${id}-btn`}
          type="button"
          className="pf-select-btn"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open ? `${id}-o${active}` : undefined}
          aria-labelledby={`${id}-legend ${id}-btn`}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKey}
        >
          {selected ? (
            <>
              <BrandIcon name={selected.brand} />
              <span className="pf-select-text">{selected.label}</span>
            </>
          ) : (
            <span className="pf-select-text pf-select-empty">{placeholder}</span>
          )}
          <svg className={`pf-select-chev${open ? " open" : ""}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <input type="hidden" name={name} value={value} />
        {open && (
          <ul ref={list} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-legend`} className="pf-select-list">
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                className="pf-select-opt"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o.value)}
                onMouseEnter={() => setActive(i)}
              >
                <BrandIcon name={o.brand} />
                <span>{o.label}</span>
                {o.value === value && (
                  <svg className="pf-select-tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
