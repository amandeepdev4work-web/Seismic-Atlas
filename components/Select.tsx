"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A dark dropdown, hand-rolled because the native one cannot be made dark.
 *
 * Chrome on Windows draws the open `<option>` list with the OS light popup and
 * ignores both `color-scheme: dark` and any `background`/`color` set on the
 * options — which rendered our near-white option text on a near-white popup.
 * Every reliable fix means not using the native popup, so this is the ARIA 1.2
 * select-only combobox pattern: a real button, a `role="listbox"`, and focus
 * that never leaves the button (the active option is pointed at with
 * `aria-activedescendant`). Keyboard support is the part that has to be right,
 * since it is the part a native select gave us for free — arrows, Home/End,
 * Enter/Space, Escape, Tab, and type-ahead.
 *
 * The list renders in normal flow rather than as a positioned overlay: the
 * mapping panel scrolls internally, and an absolutely positioned popup inside
 * a scroll container gets clipped by it. Opening one pushes the fields below
 * it down, which in a 15rem panel reads fine.
 */
export default function Select({
  value,
  options,
  onChange,
  labelledBy,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** id of the element labelling this field. */
  labelledBy: string;
}) {
  const rootId = useId();
  const listId = `${rootId}-list`;
  const triggerId = `${rootId}-trigger`;
  const optionId = (index: number) => `${rootId}-option-${index}`;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const typedRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(selectedIndex, 0));

  // Keep the highlight on the active option as it moves, without scrolling the
  // panel around it.
  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // A click anywhere else closes it, the way a native popup would.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  function openAt(index: number) {
    setActiveIndex(clamp(index, options.length));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  }

  /** Type-ahead: jump to the next option starting with what was typed. */
  function jumpTo(character: string) {
    const now = Date.now();
    const previous = typedRef.current;
    const text =
      now - previous.at < 700 ? previous.text + character : character;
    typedRef.current = { text, at: now };

    const from = open ? activeIndex : Math.max(selectedIndex, 0);
    const match = findByPrefix(options, text, from);
    if (match === -1) return;

    if (open) setActiveIndex(match);
    else choose(match);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        openAt(open ? activeIndex + 1 : Math.max(selectedIndex, 0));
        return;
      case "ArrowUp":
        event.preventDefault();
        openAt(open ? activeIndex - 1 : Math.max(selectedIndex, 0));
        return;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(activeIndex);
        else openAt(Math.max(selectedIndex, 0));
        return;
      case "Escape":
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        return;
      case "Tab":
        // Let focus leave; just do not leave a menu hanging open behind it.
        setOpen(false);
        return;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          jumpTo(event.key);
        }
    }
  }

  const selected = options[selectedIndex];

  return (
    <div className="select" ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        className="select__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        // Label first, then the current value — what a native select announces.
        aria-labelledby={`${labelledBy} ${triggerId}`}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        onClick={() => (open ? setOpen(false) : openAt(Math.max(selectedIndex, 0)))}
        onKeyDown={onKeyDown}
      >
        <span
          className={
            selected && selected.value !== ""
              ? "select__value"
              : "select__value select__value--empty"
          }
        >
          {selected ? selected.label : "—"}
        </span>
        <span aria-hidden="true" className="select__caret">
          ▾
        </span>
      </button>

      {open && (
        <ul className="select__list" id={listId} role="listbox" aria-labelledby={labelledBy}>
          {options.map((option, index) => (
            <li
              key={option.value || "__none"}
              id={optionId(index)}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              className={
                index === activeIndex
                  ? "select__option select__option--active"
                  : "select__option"
              }
              role="option"
              aria-selected={option.value === value}
              // mousedown would fire before the outside-click handler; onClick
              // after it, so the list is still open when this runs.
              onClick={() => choose(index)}
              onMouseMove={() => setActiveIndex(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Wraps at both ends, the way a native listbox does not — but arrows should. */
function clamp(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return length - 1;
  if (index >= length) return 0;
  return index;
}

/** First option after `from` whose label starts with `prefix`, wrapping once. */
function findByPrefix(
  options: readonly SelectOption[],
  prefix: string,
  from: number,
): number {
  const needle = prefix.toLowerCase();
  // A repeated single character cycles through matches; anything longer keeps
  // narrowing from where it started.
  const start = needle.length === 1 ? from + 1 : from;

  for (let step = 0; step < options.length; step += 1) {
    const index = (start + step + options.length) % options.length;
    if (options[index].label.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
