// Composer textarea with a 2px overlay caret (iss-0007). Chromium has no
// caret-width; the native caret is hidden and this one is placed from the
// collapsed selection via a same-metrics mirror.

import {
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type TextareaHTMLAttributes,
} from 'react';

export function caretVisible(state: {
  focused: boolean;
  collapsed: boolean;
  composing: boolean;
}): boolean {
  return state.focused && state.collapsed && !state.composing;
}

export function ComposerField({
  fieldRef,
  className,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [tick, setTick] = useState(0);

  function assign(node: HTMLTextAreaElement | null) {
    innerRef.current = node;
    if (fieldRef !== undefined) {
      fieldRef.current = node;
    }
  }

  useLayoutEffect(() => {
    const field = innerRef.current;
    const mirror = mirrorRef.current;
    const caret = caretRef.current;
    if (field === null || mirror === null || caret === null) {
      return;
    }
    const collapsed = field.selectionStart === field.selectionEnd;
    const show = caretVisible({ focused, collapsed, composing });
    caret.hidden = !show;
    if (!show) {
      return;
    }
    const style = getComputedStyle(field);
    mirror.style.font = style.font;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.padding = style.padding;
    mirror.style.border = style.border;
    mirror.style.boxSizing = style.boxSizing;
    mirror.style.width = `${field.clientWidth}px`;
    mirror.textContent = '';
    mirror.append(field.value.slice(0, field.selectionStart));
    const mark = document.createElement('span');
    mark.textContent = '\u200b';
    mirror.append(mark);
    const wrap = field.parentElement?.getBoundingClientRect();
    const markBox = mark.getBoundingClientRect();
    if (wrap === undefined) {
      return;
    }
    const line = markBox.height || parseFloat(style.lineHeight) || 16;
    const grow = 2;
    caret.style.height = `${line + grow}px`;
    caret.style.transform = `translate(${markBox.left - wrap.left - field.scrollLeft}px, ${
      markBox.top - wrap.top - field.scrollTop - grow / 2
    }px)`;
    caret.style.animation = 'none';
    void caret.offsetWidth;
    caret.style.animation = '';
  }, [focused, composing, tick, value]);

  return (
    <div className="composer-field">
      <textarea
        {...props}
        value={value}
        className={className}
        ref={assign}
        onFocus={(event) => {
          setFocused(true);
          setTick((n) => n + 1);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          setTick((n) => n + 1);
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          setTick((n) => n + 1);
          onKeyDown?.(event);
        }}
        onKeyUp={() => setTick((n) => n + 1)}
        onClick={() => setTick((n) => n + 1)}
        onSelect={() => setTick((n) => n + 1)}
        onScroll={() => setTick((n) => n + 1)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => {
          setComposing(false);
          setTick((n) => n + 1);
        }}
      />
      <div className="composer-mirror" ref={mirrorRef} aria-hidden />
      <div className="composer-caret" ref={caretRef} hidden aria-hidden />
    </div>
  );
}
