import { useState, useCallback, useRef } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { v4 as uuid } from "uuid";

// ─── Font options ──────────────────────────────────────────────────────────────
const FONT_OPTIONS = [
  { label: "Default (System)", value: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" },
  { label: "Georgia (Serif)", value: "Georgia,'Times New Roman',serif" },
  { label: "Garamond", value: "Garamond,'Times New Roman',serif" },
  { label: "Palatino", value: "'Palatino Linotype',Palatino,serif" },
  { label: "Arial", value: "Arial,Helvetica,sans-serif" },
  { label: "Verdana", value: "Verdana,Geneva,sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS',Helvetica,sans-serif" },
  { label: "Courier (Monospace)", value: "'Courier New',Courier,monospace" },
];

// ─── Block palette ─────────────────────────────────────────────────────────────
const BLOCK_PALETTE = [
  { type: "text",    icon: "¶",  label: "Text" },
  { type: "heading", icon: "H",  label: "Heading" },
  { type: "image",   icon: "🖼", label: "Image" },
  { type: "button",  icon: "⬛", label: "Button" },
  { type: "columns", icon: "⊟", label: "Two Columns" },
  { type: "callout", icon: "📣", label: "Callout" },
  { type: "list",    icon: "☰",  label: "List" },
  { type: "event",   icon: "📅", label: "Event Details" },
  { type: "divider", icon: "—",  label: "Divider" },
  { type: "spacer",  icon: "↕",  label: "Spacer" },
];

const DEFAULT_BLOCK = {
  text:    { content: "Your text here.", fontSize: 15, color: "#1A202C", align: "left", fontFamily: FONT_OPTIONS[0].value, forParts: [] },
  heading: { content: "Section Heading", fontSize: 22, color: "#0F1A45", align: "center", fontFamily: FONT_OPTIONS[0].value, forParts: [] },
  image:   { src: "", alt: "", link: "", width: "100%", align: "center", forParts: [] },
  button:  { label: "RSVP Now", url: "{{rsvpLink}}", bgColor: "#1B2B6B", textColor: "#FFFFFF", align: "center", borderRadius: 8, fontSize: 15, forParts: [] },
  columns: {
    left:  { type: "text", content: "Left column text.", fontSize: 14, color: "#1A202C", align: "left", src: "", alt: "", link: "", label: "Learn More", url: "{{rsvpLink}}", bgColor: "#1B2B6B", textColor: "#FFFFFF", borderRadius: 6 },
    right: { type: "text", content: "Right column text.", fontSize: 14, color: "#1A202C", align: "left", src: "", alt: "", link: "", label: "Learn More", url: "{{rsvpLink}}", bgColor: "#1B2B6B", textColor: "#FFFFFF", borderRadius: 6 },
    forParts: [],
  },
  callout: { content: "Important information for your guests.", bgColor: "#EFF6FF", borderColor: "#1B2B6B", textColor: "#0F1A45", fontSize: 14, icon: "ℹ️", forParts: [] },
  list:    { items: ["First item", "Second item", "Third item"], style: "bullet", fontSize: 14, color: "#1A202C", forParts: [] },
  event:   { showDate: true, showLocation: true, showParts: true, bgColor: "#F8FAFF", borderColor: "#1B2B6B", forParts: [] },
  divider: { color: "#E4E8F0", thickness: 1, marginTop: 12, marginBottom: 12, forParts: [] },
  spacer:  { height: 24, forParts: [] },
};

export function createBlock(type) {
  return { id: uuid(), type, ...JSON.parse(JSON.stringify(DEFAULT_BLOCK[type])) };
}

// ─── HTML generation ────────────────────────────────────────────────────────────
export function blocksToHtml(blocks, resolveToken, event, guestInvitedParts) {
  const r = resolveToken || ((s) => s);
  return blocks
    .filter((b) => {
      if (!b.forParts || b.forParts.length === 0) return true;
      if (!guestInvitedParts || guestInvitedParts.length === 0) return true;
      return b.forParts.some((pid) => guestInvitedParts.includes(pid));
    })
    .map((b) => blockToHtml(b, r, event, guestInvitedParts))
    .join("\n");
}

function colHtml(col, r) {
  switch (col.type) {
    case "image":
      if (!col.src) return `<div style="color:#94A0B8;font-size:13px;text-align:center;">[Image]</div>`;
      const img = `<img src="${col.src}" alt="${col.alt || ""}" style="max-width:100%;display:block;border:0;" />`;
      return col.link ? `<a href="${r(col.link)}" style="text-decoration:none;">${img}</a>` : img;
    case "button":
      return `<div style="text-align:${col.align || "center"};"><a href="${r(col.url || "")}" style="display:inline-block;background:${col.bgColor};color:${col.textColor};padding:9px 20px;border-radius:${col.borderRadius || 6}px;text-decoration:none;font-weight:700;font-size:${col.fontSize || 14}px;">${r(col.label || "Button")}</a></div>`;
    default:
      return `<div style="font-size:${col.fontSize || 14}px;color:${col.color || "#1A202C"};text-align:${col.align || "left"};line-height:1.6;">${r(col.content || "")}</div>`;
  }
}

function blockToHtml(b, r, event, guestInvitedParts) {
  switch (b.type) {
    case "text":
    case "heading": {
      const tag = b.type === "heading" ? "h2" : "p";
      const ff = b.fontFamily || FONT_OPTIONS[0].value;
      // Convert newlines to <br> for proper indentation/whitespace in email
      const htmlContent = (b.content || "").replace(/\n/g, "<br>");
      return `<${tag} style="font-size:${b.fontSize}px;color:${b.color};text-align:${b.align};font-family:${ff};margin:0 0 8px;padding:0;line-height:1.7;">${r(htmlContent)}</${tag}>`;
    }
    case "image": {
      if (!b.src) return `<div style="text-align:${b.align};padding:8px 0;color:#94A0B8;font-size:13px;">[Image — add URL in settings]</div>`;
      const img = `<img src="${b.src}" alt="${b.alt || ""}" width="${b.width || "100%"}" style="display:block;max-width:100%;border:0;" />`;
      const content = b.link ? `<a href="${r(b.link)}" style="text-decoration:none;">${img}</a>` : img;
      return `<div style="text-align:${b.align};padding:4px 0;">${content}</div>`;
    }
    case "button": {
      const url = r(b.url || "{{rsvpLink}}");
      const label = r(b.label || "RSVP Now");
      const br = b.borderRadius ?? 8;
      return `<div style="text-align:${b.align || "center"};margin:12px 0 4px;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="${Math.round((br / 22) * 100)}%" strokecolor="${b.bgColor}" fillcolor="${b.bgColor}">
<w:anchorlock/><center style="color:${b.textColor};font-family:sans-serif;font-size:${b.fontSize ?? 15}px;font-weight:700;">${label}</center>
</v:roundrect><![endif]-->
<!--[if !mso]><!-->
<a href="${url}" style="display:inline-block;background:${b.bgColor};color:${b.textColor};padding:12px 28px;border-radius:${br}px;text-decoration:none;font-weight:700;font-size:${b.fontSize ?? 15}px;letter-spacing:0.01em;mso-hide:all;">${label}</a>
<!--<![endif]-->
</div>`;
    }
    case "columns":
      return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0;">
<tr>
  <td width="48%" valign="top" style="padding-right:10px;">${colHtml(b.left || {}, r)}</td>
  <td width="4%" />
  <td width="48%" valign="top" style="padding-left:10px;">${colHtml(b.right || {}, r)}</td>
</tr></table>`;
    case "callout":
      return `<div style="background:${b.bgColor || "#EFF6FF"};border-left:4px solid ${b.borderColor || "#1B2B6B"};padding:14px 16px;border-radius:6px;margin:8px 0;">
  <div style="font-size:${b.fontSize || 14}px;color:${b.textColor || "#0F1A45"};line-height:1.6;">${b.icon ? `${b.icon} ` : ""}${r((b.content || "").replace(/\n/g, "<br>"))}</div>
</div>`;
    case "list": {
      const tag = b.style === "numbered" ? "ol" : "ul";
      const items = (b.items || []).map((item) => `<li style="margin-bottom:4px;">${r(item)}</li>`).join("");
      return `<${tag} style="font-size:${b.fontSize || 14}px;color:${b.color || "#1A202C"};padding-left:20px;margin:4px 0 8px;">${items}</${tag}>`;
    }
    case "event": {
      if (!event) return "";
      const dateStr = event.date ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "";
      // Only show parts the guest is invited to
      const parts = (event.parts || []).filter((p) => {
        if (!p.name) return false;
        if (!guestInvitedParts || guestInvitedParts.length === 0) return true;
        return guestInvitedParts.includes(p.id);
      });
      return `<div style="background:${b.bgColor || "#F8FAFF"};border:1.5px solid ${b.borderColor || "#1B2B6B"};border-radius:8px;padding:16px 20px;margin:8px 0;">
  <div style="font-weight:700;font-size:16px;color:#0F1A45;margin-bottom:8px;">${event.name || ""}</div>
  ${b.showDate && dateStr ? `<div style="font-size:14px;color:#1A202C;margin-bottom:4px;">📅 ${dateStr}</div>` : ""}
  ${b.showLocation && event.location ? `<div style="font-size:14px;color:#1A202C;margin-bottom:4px;">📍 ${event.location}</div>` : ""}
  ${b.showParts && parts.length > 0 ? parts.map((p) => `<div style="font-size:13px;color:#4A5568;margin-top:2px;">· ${p.name}${p.startTime ? ": " + fmt24(p.startTime) : ""}${p.endTime ? " – " + fmt24(p.endTime) : ""}</div>`).join("") : ""}
</div>`;
    }
    case "divider":
      return `<div style="margin:${b.marginTop ?? 12}px 0 ${b.marginBottom ?? 12}px;"><hr style="border:none;border-top:${b.thickness ?? 1}px solid ${b.color ?? "#E4E8F0"};margin:0;" /></div>`;
    case "spacer":
      return `<div style="height:${b.height ?? 24}px;font-size:1px;line-height:1px;">&nbsp;</div>`;
    default:
      return "";
  }
}

function fmt24(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
}

// ─── Merge tokens ──────────────────────────────────────────────────────────────
const MERGE_TOKENS = ["{{firstName}}", "{{lastName}}", "{{fullName}}", "{{staffPOC}}", "{{eventName}}", "{{eventDate}}", "{{eventLocation}}", "{{rsvpLink}}"];

// ─── Rich text toolbar ─────────────────────────────────────────────────────────
function RichTextToolbar({ textareaRef, value, onChange }) {
  const wrap = (open, close) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + open + selected + close + value.slice(end);
    onChange(next);
    setTimeout(() => {
      el.focus();
      el.selectionStart = start + open.length;
      el.selectionEnd = end + open.length;
    }, 0);
  };

  const insertToken = (token) => {
    const el = textareaRef.current;
    if (!el) { onChange(value + token); return; }
    const start = el.selectionStart;
    const next = value.slice(0, start) + token + value.slice(el.selectionEnd);
    onChange(next);
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; }, 0);
  };

  const btnStyle = (active = false) => ({
    padding: "3px 7px", border: "1px solid var(--gray-200)", borderRadius: 5,
    background: active ? "var(--navy)" : "white", color: active ? "white" : "var(--gray-700)",
    cursor: "pointer", fontSize: "0.75rem", fontWeight: 700, lineHeight: 1.4,
  });

  return (
    <div style={{ marginBottom: "0.375rem" }}>
      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
        <button type="button" style={btnStyle()} onMouseDown={(e) => { e.preventDefault(); wrap("<strong>", "</strong>"); }} title="Bold"><b>B</b></button>
        <button type="button" style={{ ...btnStyle(), fontStyle: "italic" }} onMouseDown={(e) => { e.preventDefault(); wrap("<em>", "</em>"); }} title="Italic"><i>I</i></button>
        <button type="button" style={{ ...btnStyle(), textDecoration: "underline" }} onMouseDown={(e) => { e.preventDefault(); wrap("<u>", "</u>"); }} title="Underline"><u>U</u></button>
        <button type="button" style={btnStyle()} onMouseDown={(e) => { e.preventDefault(); wrap('<a href="" style="color:#1B2B6B;">', "</a>"); }} title="Link">🔗</button>
        <div style={{ width: 1, background: "var(--gray-200)", margin: "0 2px" }} />
        {MERGE_TOKENS.map((t) => (
          <button key={t} type="button" style={{ ...btnStyle(), fontSize: "0.6rem", color: "var(--navy)", borderColor: "var(--navy-light)", background: "var(--navy-xlight)" }}
            onMouseDown={(e) => { e.preventDefault(); insertToken(t); }}>
            {t.replace(/[{}]/g, "")}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Inline rich text editor ───────────────────────────────────────────────────
function RichTextEditor({ value, onChange, minHeight = 64, placeholder }) {
  const ref = useRef(null);
  return (
    <div onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <RichTextToolbar textareaRef={ref} value={value || ""} onChange={onChange} />
      <textarea
        ref={ref}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", border: "1.5px solid var(--navy)", borderRadius: 6, padding: "7px 9px", fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box", minHeight, fontSize: "0.875rem" }}
      />
      {value && value.includes("<") && (
        <div style={{ marginTop: "0.25rem", padding: "6px 8px", background: "var(--gray-50)", border: "1px solid var(--gray-100)", borderRadius: 5, fontSize: "0.75rem", color: "var(--gray-500)" }}>
          Preview: <span dangerouslySetInnerHTML={{ __html: value }} />
        </div>
      )}
    </div>
  );
}

// ─── Single-line text input with merge tokens ──────────────────────────────────
function InlineInput({ value, onChange, placeholder, style: extraStyle }) {
  const ref = useRef(null);
  const insertToken = (token) => {
    const el = ref.current;
    if (!el) { onChange((value || "") + token); return; }
    const start = el.selectionStart;
    const next = (value || "").slice(0, start) + token + (value || "").slice(el.selectionEnd);
    onChange(next);
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; }, 0);
  };
  return (
    <div onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <input ref={ref} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", border: "1.5px solid var(--navy)", borderRadius: 6, padding: "5px 8px", fontFamily: "inherit", outline: "none", boxSizing: "border-box", fontSize: "0.875rem", ...extraStyle }} />
    </div>
  );
}

// ─── Canvas block content — shows inline editor when selected ──────────────────
function BlockContent({ block, selected, onUpdate, event }) {
  const set = (field, val) => onUpdate({ ...block, [field]: val });
  const setCol = (side, field, val) => onUpdate({ ...block, [side]: { ...block[side], [field]: val } });

  switch (block.type) {
    case "text":
    case "heading":
      if (selected) {
        return (
          <RichTextEditor value={block.content} onChange={(v) => set("content", v)}
            minHeight={block.type === "heading" ? 44 : 72}
            placeholder={`Type your ${block.type}...`} />
        );
      }
      return (
        <div style={{ fontSize: Math.min(block.fontSize ?? 15, 20), color: block.color, textAlign: block.align, lineHeight: 1.7, padding: "3px 0", wordBreak: "break-word", fontFamily: block.fontFamily || "inherit", whiteSpace: "pre-wrap" }}>
          {block.content
            ? <span dangerouslySetInnerHTML={{ __html: (block.content || "").replace(/\n/g, "<br>") }} />
            : <span style={{ color: "var(--gray-300)", fontStyle: "italic" }}>Click to edit {block.type}...</span>}
        </div>
      );

    case "image":
      return block.src
        ? <div style={{ textAlign: block.align, padding: "4px 0" }}><img src={block.src} alt={block.alt || ""} style={{ maxWidth: "100%", maxHeight: 120, display: "inline-block" }} /></div>
        : <div style={{ textAlign: "center", padding: "12px", background: "var(--gray-50)", border: "2px dashed var(--gray-200)", borderRadius: 6, color: "var(--gray-400)", fontSize: 13 }}>🖼 Add image URL in settings →</div>;

    case "button":
      if (selected) {
        return (
          <div onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ textAlign: block.align || "center", padding: "4px 0" }}>
            <input value={block.label || ""} onChange={(e) => set("label", e.target.value)} placeholder="Button label"
              style={{ display: "inline-block", textAlign: "center", background: block.bgColor, color: block.textColor, padding: "9px 20px", borderRadius: block.borderRadius ?? 8, fontWeight: 700, fontSize: block.fontSize ?? 15, border: "2px solid " + block.bgColor, outline: "2px solid var(--navy)", outlineOffset: 2, cursor: "text", boxSizing: "border-box" }} />
          </div>
        );
      }
      return (
        <div style={{ textAlign: block.align || "center", padding: "6px 0" }}>
          <span style={{ display: "inline-block", background: block.bgColor, color: block.textColor, padding: "9px 22px", borderRadius: block.borderRadius ?? 8, fontWeight: 700, fontSize: block.fontSize ?? 15 }}>
            {block.label || "Button"}
          </span>
        </div>
      );

    case "columns": {
      const renderCol = (side) => {
        const col = block[side] || {};
        const label = side === "left" ? "LEFT" : "RIGHT";
        return (
          <div style={{ flex: 1, border: selected ? "1.5px solid var(--gray-200)" : "none", borderRadius: 6, padding: selected ? "6px" : 0 }}>
            {selected && (
              <div style={{ marginBottom: "0.25rem", display: "flex", gap: "0.25rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "var(--gray-400)", textTransform: "uppercase" }}>{label}</span>
                <select value={col.type || "text"} onChange={(e) => setCol(side, "type", e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                  style={{ fontSize: "0.65rem", padding: "1px 4px", border: "1px solid var(--gray-200)", borderRadius: 4 }}>
                  <option value="text">Text</option>
                  <option value="image">Image</option>
                  <option value="button">Button</option>
                </select>
              </div>
            )}
            {selected && col.type === "text" && (
              <RichTextEditor value={col.content} onChange={(v) => setCol(side, "content", v)} minHeight={48} placeholder="Column text..." />
            )}
            {selected && col.type === "image" && (
              <div onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                <input className="form-input" style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }} value={col.src || ""} onChange={(e) => setCol(side, "src", e.target.value)} placeholder="Image URL" />
                <input className="form-input" style={{ fontSize: "0.75rem" }} value={col.link || ""} onChange={(e) => setCol(side, "link", e.target.value)} placeholder="Link URL (optional)" />
              </div>
            )}
            {selected && col.type === "button" && (
              <div onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                <input className="form-input" style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }} value={col.label || ""} onChange={(e) => setCol(side, "label", e.target.value)} placeholder="Button label" />
                <input className="form-input" style={{ fontSize: "0.75rem" }} value={col.url || ""} onChange={(e) => setCol(side, "url", e.target.value)} placeholder="Link URL or {{rsvpLink}}" />
              </div>
            )}
            {!selected && (
              col.type === "image"
                ? col.src ? <img src={col.src} alt="" style={{ maxWidth: "100%", maxHeight: 60, display: "block" }} /> : <div style={{ color: "var(--gray-300)", fontSize: 11, textAlign: "center" }}>🖼 Image</div>
                : col.type === "button"
                  ? <div style={{ textAlign: col.align || "center" }}><span style={{ display: "inline-block", background: col.bgColor || "#1B2B6B", color: col.textColor || "#FFF", padding: "5px 14px", borderRadius: col.borderRadius || 6, fontWeight: 700, fontSize: 12 }}>{col.label || "Button"}</span></div>
                  : <div style={{ fontSize: 12, color: col.color || "#1A202C" }}>{col.content ? <span dangerouslySetInnerHTML={{ __html: col.content }} /> : <span style={{ color: "var(--gray-300)" }}>Column text</span>}</div>
            )}
          </div>
        );
      };
      return (
        <div style={{ display: "flex", gap: 8 }}>
          {renderCol("left")}
          <div style={{ width: 1, background: "var(--gray-100)", flexShrink: 0 }} />
          {renderCol("right")}
        </div>
      );
    }

    case "callout":
      if (selected) {
        return (
          <div style={{ background: block.bgColor || "#EFF6FF", borderLeft: `4px solid ${block.borderColor || "#1B2B6B"}`, padding: "10px 12px", borderRadius: 6 }}>
            <RichTextEditor value={block.content} onChange={(v) => set("content", v)} minHeight={48} placeholder="Callout text..." />
          </div>
        );
      }
      return (
        <div style={{ background: block.bgColor || "#EFF6FF", borderLeft: `4px solid ${block.borderColor || "#1B2B6B"}`, padding: "10px 12px", borderRadius: 6, fontSize: block.fontSize || 14, color: block.textColor || "#0F1A45", lineHeight: 1.6 }}>
          {block.icon && <span style={{ marginRight: 6 }}>{block.icon}</span>}
          {block.content ? <span dangerouslySetInnerHTML={{ __html: block.content }} /> : <span style={{ color: "var(--gray-300)", fontStyle: "italic" }}>Callout text...</span>}
        </div>
      );

    case "list":
      if (selected) {
        return (
          <div onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.375rem" }}>
              {["bullet", "numbered"].map((s) => (
                <button key={s} type="button" onClick={() => set("style", s)}
                  style={{ padding: "2px 8px", border: "1px solid var(--gray-200)", borderRadius: 5, background: block.style === s ? "var(--navy)" : "white", color: block.style === s ? "white" : "var(--gray-600)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
                  {s === "bullet" ? "• Bullet" : "1. Numbered"}
                </button>
              ))}
            </div>
            {(block.items || []).map((item, i) => (
              <div key={i} style={{ display: "flex", gap: "0.25rem", marginBottom: "0.25rem", alignItems: "center" }}>
                <span style={{ color: "var(--gray-400)", fontSize: 12, minWidth: 16 }}>{block.style === "numbered" ? `${i + 1}.` : "•"}</span>
                <input value={item} onChange={(e) => { const items = [...block.items]; items[i] = e.target.value; set("items", items); }}
                  style={{ flex: 1, border: "1px solid var(--gray-200)", borderRadius: 5, padding: "3px 7px", fontSize: "0.875rem", outline: "none" }} />
                <button type="button" onClick={() => set("items", block.items.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "var(--gray-300)", cursor: "pointer", fontSize: 12 }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={() => set("items", [...(block.items || []), "New item"])}
              style={{ fontSize: "0.75rem", color: "var(--navy)", background: "none", border: "1px dashed var(--navy-light)", borderRadius: 5, padding: "2px 8px", cursor: "pointer", marginTop: "0.25rem" }}>
              ＋ Add item
            </button>
          </div>
        );
      }
      return (
        <div style={{ fontSize: 13, color: block.color || "#1A202C", lineHeight: 1.7 }}>
          {(block.items || []).map((item, i) => (
            <div key={i}>{block.style === "numbered" ? `${i + 1}. ` : "• "}{item}</div>
          ))}
        </div>
      );

    case "event":
      return (
        <div style={{ background: block.bgColor || "#F8FAFF", border: `1.5px solid ${block.borderColor || "#1B2B6B"}`, borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#0F1A45", marginBottom: 6 }}>{event?.name || "Event Name"}</div>
          {block.showDate && event?.date && <div style={{ fontSize: 13, color: "#1A202C", marginBottom: 3 }}>📅 {(event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>}
          {block.showLocation && event?.location && <div style={{ fontSize: 13, color: "#1A202C", marginBottom: 3 }}>📍 {event.location}</div>}
          {block.showParts && (event?.parts || []).filter((p) => p.name).map((p, i) => (
            <div key={i} style={{ fontSize: 12, color: "#4A5568", marginTop: 2 }}>· {p.name}{p.startTime ? ": " + fmt24(p.startTime) : ""}{p.endTime ? " – " + fmt24(p.endTime) : ""}</div>
          ))}
          {selected && !event && <div style={{ fontSize: 12, color: "var(--gray-400)", fontStyle: "italic", marginTop: 4 }}>Event details will auto-populate from your event when sending.</div>}
        </div>
      );

    case "divider":
      return <div style={{ margin: "8px 0" }}><hr style={{ border: "none", borderTop: `${block.thickness ?? 1}px solid ${block.color ?? "#E4E8F0"}`, margin: 0 }} /></div>;

    case "spacer":
      return <div style={{ height: Math.max(8, (block.height ?? 24) / 2), background: "repeating-linear-gradient(45deg, transparent, transparent 4px, var(--gray-100) 4px, var(--gray-100) 8px)", borderRadius: 3, margin: "2px 0" }} />;

    default: return null;
  }
}

// ─── Sortable block ─────────────────────────────────────────────────────────────
function SortableBlock({ block, selected, onSelect, onDelete, onUpdate, event }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const hasPartFilter = block.forParts && block.forParts.length > 0;
  const partNames = hasPartFilter && event ? block.forParts.map((pid) => (event.parts || []).find((p) => p.id === pid)?.name).filter(Boolean).join(", ") : "";
  return (
    <div ref={setNodeRef} style={style}
      onClick={(e) => { e.stopPropagation(); onSelect(block.id); }}
      className={selected ? "designer-block selected" : "designer-block"}>
      <div className="block-drag-handle" {...attributes} {...listeners} title="Drag to reorder">⠿</div>
      <div className="block-preview">
        {hasPartFilter && (
          <div style={{ fontSize: "0.6rem", fontWeight: 700, color: "var(--navy)", background: "var(--navy-xlight)", borderRadius: 4, padding: "1px 6px", marginBottom: 4, display: "inline-block" }}>
            👁 {partNames} only
          </div>
        )}
        <BlockContent block={block} selected={selected} onUpdate={onUpdate} event={event} />
      </div>
      <button className="block-delete" onClick={(e) => { e.stopPropagation(); onDelete(block.id); }} title="Remove">✕</button>
    </div>
  );
}

// ─── Right panel settings ──────────────────────────────────────────────────────
function BlockSettings({ block, onChange, event }) {
  if (!block) return (
    <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--gray-400)", fontSize: "0.875rem" }}>
      <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>👆</div>
      Click any block to select it, then type directly on the canvas
    </div>
  );

  const set = (field, val) => onChange({ ...block, [field]: val });

  const colorInput = (label, field) => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="color" value={block[field] || "#000000"} onChange={(e) => set(field, e.target.value)} style={{ width: 32, height: 28, border: "1px solid var(--gray-200)", borderRadius: 5, cursor: "pointer", padding: 2 }} />
        <input type="text" value={block[field] || ""} onChange={(e) => set(field, e.target.value)} style={{ flex: 1, padding: "0.3rem 0.5rem", border: "1.5px solid var(--gray-200)", borderRadius: 5, fontSize: "0.75rem", fontFamily: "monospace" }} />
      </div>
    </div>
  );

  const numInput = (label, field, min, max, defaultVal) => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input type="range" min={min} max={max} value={block[field] ?? defaultVal ?? 15} onChange={(e) => set(field, parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--navy)" }} />
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--gray-600)", minWidth: 26 }}>{block[field] ?? defaultVal ?? 15}</span>
      </div>
    </div>
  );

  const alignBtns = (field = "align") => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Alignment</label>
      <div style={{ display: "flex", gap: "0.25rem" }}>
        {["left", "center", "right"].map((a) => (
          <button key={a} onClick={() => set(field, a)}
            style={{ flex: 1, padding: "0.3rem", border: "1.5px solid var(--gray-200)", borderRadius: 5, background: (block[field] || "left") === a ? "var(--navy)" : "white", color: (block[field] || "left") === a ? "white" : "var(--gray-600)", cursor: "pointer", fontSize: "0.8rem" }}>
            {a === "left" ? "⬅" : a === "center" ? "↔" : "➡"}
          </button>
        ))}
      </div>
    </div>
  );

  const textInput = (label, field, placeholder = "") => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <input className="form-input" style={{ fontSize: "0.8rem" }} value={block[field] ?? ""} onChange={(e) => set(field, e.target.value)} placeholder={placeholder} />
    </div>
  );

  const title = (t) => <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "0.875rem", fontSize: "0.875rem", borderBottom: "1px solid var(--gray-100)", paddingBottom: "0.5rem" }}>{t}</div>;

  const forPartsInput = (blk, setter, ev) => {
    if (!ev || (ev.parts || []).length <= 1) return null;
    return (
      <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--gray-100)" }}>
        <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Show only to guests invited to
        </label>
        <div style={{ fontSize: "0.75rem", color: "var(--gray-400)", marginBottom: "0.375rem" }}>Leave all unchecked to show to everyone.</div>
        {ev.parts.map((p) => (
          <label key={p.id} className="checkbox-label" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
            <input type="checkbox"
              checked={(blk.forParts || []).includes(p.id)}
              onChange={() => setter("forParts", (blk.forParts || []).includes(p.id) ? (blk.forParts || []).filter((x) => x !== p.id) : [...(blk.forParts || []), p.id])} />
            {p.name}
          </label>
        ))}
        {(blk.forParts || []).length > 0 && (
          <div style={{ marginTop: "0.375rem", padding: "0.3rem 0.5rem", background: "var(--navy-xlight)", borderRadius: 5, fontSize: "0.7rem", color: "var(--navy)", fontWeight: 600 }}>
            ✓ Only shown to: {(blk.forParts || []).map((pid) => ev.parts.find((p) => p.id === pid)?.name).filter(Boolean).join(", ")}
          </div>
        )}
      </div>
    );
  };
  const inlineNote = <div style={{ background: "var(--navy-xlight)", border: "1px solid var(--navy-light)", borderRadius: 5, padding: "0.4rem 0.625rem", fontSize: "0.72rem", color: "var(--navy)", marginBottom: "0.75rem" }}>✏️ Type directly on the canvas</div>;

  switch (block.type) {
    case "text":
    case "heading":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title(block.type === "heading" ? "Heading" : "Text")}
          {inlineNote}
          {numInput("Font Size", "fontSize", 10, 48, block.type === "heading" ? 22 : 15)}
          {colorInput("Color", "color")}
          {alignBtns()}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Font</label>
            <select className="form-select" style={{ fontSize: "0.8rem" }} value={block.fontFamily || FONT_OPTIONS[0].value} onChange={(e) => set("fontFamily", e.target.value)}>
              {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          {forPartsInput(block, set, event)}
        </div>
      );
    case "image":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Image")}
          {textInput("Image URL", "src", "https://...")}
          {textInput("Alt Text", "alt", "Description")}
          {textInput("Link URL", "link", "https://... or {{rsvpLink}}")}
          {textInput("Width", "width", "100% or 300px")}
          {alignBtns()}
          {forPartsInput(block, set, event)}
        </div>
      );
    case "button":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Button")}
          {inlineNote}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link URL</label>
            <button type="button" onClick={() => set("url", "{{rsvpLink}}")} style={{ fontSize: "0.65rem", padding: "2px 7px", border: "1px solid var(--navy-light)", borderRadius: 4, background: "var(--navy-xlight)", color: "var(--navy)", cursor: "pointer", fontWeight: 700, marginBottom: "0.25rem" }}>rsvpLink ↙</button>
            <input className="form-input" style={{ fontSize: "0.8rem" }} value={block.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="{{rsvpLink}} or https://..." />
          </div>
          {colorInput("Button Color", "bgColor")}
          {colorInput("Text Color", "textColor")}
          {numInput("Font Size", "fontSize", 10, 24, 15)}
          {numInput("Border Radius", "borderRadius", 0, 30, 8)}
          {alignBtns()}
          {forPartsInput(block, set, event)}
        </div>
      );
    case "columns":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Two Columns")}
          <div style={{ fontSize: "0.8rem", color: "var(--gray-500)", marginBottom: "0.75rem", lineHeight: 1.5 }}>
            Each column can contain <strong>Text</strong>, an <strong>Image</strong>, or a <strong>Button</strong>. Select the column type directly on the canvas when the block is selected.
          </div>
          {forPartsInput(block, set, event)}
        </div>
      );
    case "callout":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Callout")}
          {inlineNote}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Icon (emoji)</label>
            <input className="form-input" style={{ fontSize: "0.875rem", maxWidth: 60 }} value={block.icon || ""} onChange={(e) => set("icon", e.target.value)} placeholder="ℹ️" />
          </div>
          {colorInput("Background", "bgColor")}
          {colorInput("Border Color", "borderColor")}
          {colorInput("Text Color", "textColor")}
          {numInput("Font Size", "fontSize", 10, 24, 14)}
          {forPartsInput(block, set, event)}
        </div>
      );
    case "list":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("List")}
          <div style={{ fontSize: "0.8rem", color: "var(--gray-500)", marginBottom: "0.75rem" }}>Edit list items directly on the canvas.</div>
          {colorInput("Text Color", "color")}
          {numInput("Font Size", "fontSize", 10, 24, 14)}
          {forPartsInput(block, set, event)}
        </div>
      );
    case "event":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Event Details")}
          <div style={{ fontSize: "0.8rem", color: "var(--gray-500)", marginBottom: "0.75rem" }}>Auto-populated from your event. Only shows parts the recipient is invited to.</div>
          {["showDate", "showLocation", "showParts"].map((field) => (
            <label key={field} className="checkbox-label" style={{ marginBottom: "0.5rem", fontSize: "0.875rem" }}>
              <input type="checkbox" checked={block[field] !== false} onChange={(e) => set(field, e.target.checked)} />
              Show {field.replace("show", "").replace(/([A-Z])/g, " $1").trim()}
            </label>
          ))}
          {colorInput("Background", "bgColor")}
          {colorInput("Border Color", "borderColor")}
          {forPartsInput(block, set, event)}
        </div>
      );
    case "divider":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Divider")}
          {colorInput("Color", "color")}
          {numInput("Thickness", "thickness", 1, 10, 1)}
          {numInput("Space Above", "marginTop", 0, 60, 12)}
          {numInput("Space Below", "marginBottom", 0, 60, 12)}
        </div>
      );
    case "spacer":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Spacer")}
          {numInput("Height (px)", "height", 4, 120, 24)}
        </div>
      );
    default: return null;
  }
}

// ─── Palette item ───────────────────────────────────────────────────────────────
function PaletteItem({ type, icon, label, onAdd }) {
  return (
    <button onClick={() => onAdd(type)}
      style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.625rem", borderRadius: 7, border: "1.5px solid var(--gray-200)", background: "white", cursor: "pointer", marginBottom: "0.3rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--gray-700)", width: "100%", textAlign: "left", transition: "all 0.12s" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--navy)"; e.currentTarget.style.background = "var(--navy-xlight)"; e.currentTarget.style.color = "var(--navy)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--gray-200)"; e.currentTarget.style.background = "white"; e.currentTarget.style.color = "var(--gray-700)"; }}>
      <span style={{ fontSize: "0.9rem", width: 18, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────
export default function EmailDesigner({ blocks, onChange, subject, onSubjectChange, buttonText, onButtonTextChange, event }) {
  const [selectedId, setSelectedId] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const selectedBlock = blocks.find((b) => b.id === selectedId);

  const addBlock = useCallback((type) => {
    const b = createBlock(type);
    onChange((prev) => [...prev, b]);
    setSelectedId(b.id);
    setTimeout(() => document.getElementById("designer-canvas")?.scrollTo({ top: 99999, behavior: "smooth" }), 50);
  }, [onChange]);

  const updateBlock = useCallback((updated) => {
    onChange((prev) => prev.map((b) => b.id === updated.id ? updated : b));
  }, [onChange]);

  const deleteBlock = useCallback((blockId) => {
    onChange((prev) => prev.filter((b) => b.id !== blockId));
    if (selectedId === blockId) setSelectedId(null);
  }, [onChange, selectedId]);

  const duplicateBlock = useCallback((blockId) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    const copy = { ...JSON.parse(JSON.stringify(block)), id: uuid() };
    onChange((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setSelectedId(copy.id);
  }, [blocks, onChange]);

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    onChange((prev) => {
      const oi = prev.findIndex((b) => b.id === active.id);
      const ni = prev.findIndex((b) => b.id === over.id);
      return (oi === -1 || ni === -1) ? prev : arrayMove(prev, oi, ni);
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 228px", gap: "0.875rem", minHeight: 520 }}>

      {/* Palette */}
      <div style={{ background: "var(--white)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "0.5rem 0.75rem", background: "var(--gray-50)", borderBottom: "1px solid var(--gray-100)", fontSize: "0.68rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Add Block</div>
        <div style={{ padding: "0.4rem" }}>
          <div style={{ fontSize: "0.68rem", color: "var(--gray-400)", marginBottom: "0.3rem", paddingLeft: "0.2rem" }}>Click to add ↓</div>
          {BLOCK_PALETTE.map((p) => <PaletteItem key={p.type} {...p} onAdd={addBlock} />)}
        </div>
      </div>

      {/* Canvas */}
      <div style={{ background: "var(--white)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-lg)", overflow: "hidden", display: "flex", flexDirection: "column" }}
        onClick={() => setSelectedId(null)}>
        <div style={{ background: "#0F1A45", padding: "13px 20px", textAlign: "center", flexShrink: 0 }}>
          <img src="https://bpickert99.github.io/cspc-events/cspc-logo.png" alt="CSPC" style={{ height: 28, filter: "brightness(0) invert(1)", display: "inline-block" }} />
        </div>
        <div id="designer-canvas" style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem", minHeight: 200 }}>
          {blocks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--gray-400)", fontSize: "0.875rem", border: "2px dashed var(--gray-200)", borderRadius: 8 }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎨</div>
              Click a block type on the left to start building<br />
              <span style={{ fontSize: "0.8rem", color: "var(--gray-300)" }}>Grab ⠿ handle to reorder</span>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                {blocks.map((block) => (
                  <SortableBlock key={block.id} block={block}
                    selected={selectedId === block.id}
                    onSelect={setSelectedId}
                    onDelete={deleteBlock}
                    onUpdate={updateBlock}
                    event={event}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
        <div style={{ background: "#F6F8FC", borderTop: "1px solid #E4E8F0", padding: "9px 20px", textAlign: "center", fontSize: 11, color: "#94A0B8", flexShrink: 0 }}>
          Center for the Study of the Presidency and Congress · Washington, D.C.<br />
          601 13th Street NW, Suite 940N, Washington, DC 20005
        </div>
      </div>

      {/* Settings */}
      <div style={{ background: "var(--white)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-lg)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "0.5rem 0.75rem", background: "var(--gray-50)", borderBottom: "1px solid var(--gray-100)", fontSize: "0.68rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Format</div>
        <div style={{ padding: "0.5rem", borderBottom: "1px solid var(--gray-100)" }}>
          <div style={{ marginBottom: "0.4rem" }}>
            <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Subject</label>
            <input className="form-input" style={{ fontSize: "0.8rem" }} value={subject || ""} onChange={(e) => onSubjectChange(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Button Text</label>
            <input className="form-input" style={{ fontSize: "0.8rem" }} value={buttonText || "RSVP Now"} onChange={(e) => onButtonTextChange(e.target.value)} placeholder="RSVP Now" />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          <BlockSettings block={selectedBlock} onChange={updateBlock} event={event} />
        </div>
        {selectedBlock && (
          <div style={{ padding: "0.4rem", borderTop: "1px solid var(--gray-100)", display: "flex", gap: "0.3rem" }}>
            <button className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: "0.72rem" }} onClick={() => duplicateBlock(selectedId)}>Duplicate</button>
            <button className="btn btn-danger btn-sm" style={{ flex: 1, fontSize: "0.72rem" }} onClick={() => deleteBlock(selectedId)}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}
