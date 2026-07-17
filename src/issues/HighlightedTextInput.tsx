import type { ChangeEvent, UIEvent } from "react";
import { useRef } from "react";
import type { SmartToken } from "./smartInput";

export type DisplayToken = SmartToken & { matched: boolean };

interface HighlightedTextInputProps {
  value: string;
  onChange: (value: string) => void;
  /** インライン表示するトークン（マッチ有無で見た目を変える・B3-3）。 */
  tokens: DisplayToken[];
  placeholder?: string;
  enterKeyHint?: "send" | "search";
  autoCapitalize?: string;
  autoFocus?: boolean;
}

/** `#repo` `@label` トークン（B3-3）をインライン認識・ハイライト表示するテキスト入力。
 * 実体は透明文字色の通常の input 要素（フォーカス・IME・a11y はネイティブ挙動のまま）で、
 * その背後に同じフォント指標で描画したオーバーレイ（aria-hidden）を重ねてハイライトを表現する
 * （追加ライブラリなし・design-guidelines D-6）。 */
export function HighlightedTextInput({
  value,
  onChange,
  tokens,
  placeholder,
  enterKeyHint,
  autoCapitalize,
  autoFocus,
}: HighlightedTextInputProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  // 入力欄が横スクロールした際、オーバーレイも同期させて文字位置のズレを防ぐ。
  function handleScroll(e: UIEvent<HTMLInputElement>) {
    if (overlayRef.current) overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }

  const sorted = [...tokens].sort((a, b) => a.start - b.start);
  const segments: { text: string; matched?: boolean }[] = [];
  let cursor = 0;
  for (const t of sorted) {
    if (t.start > cursor) segments.push({ text: value.slice(cursor, t.start) });
    segments.push({ text: value.slice(t.start, t.end), matched: t.matched });
    cursor = Math.max(cursor, t.end);
  }
  if (cursor < value.length || value.length === 0) segments.push({ text: value.slice(cursor) });

  return (
    <div className="highlighted-input">
      <div className="highlighted-input-overlay" ref={overlayRef} aria-hidden="true">
        {value.length === 0 && placeholder ? (
          <span className="highlighted-input-placeholder">{placeholder}</span>
        ) : (
          segments.map((seg, i) =>
            seg.matched ? (
              <mark key={i} className="smart-token">
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )
        )}
      </div>
      <input
        type="text"
        className="highlighted-input-field"
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        placeholder={placeholder}
        enterKeyHint={enterKeyHint}
        autoCapitalize={autoCapitalize}
        autoFocus={autoFocus}
      />
    </div>
  );
}
