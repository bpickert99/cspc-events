import { useState, useCallback, useRef, useEffect } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { v4 as uuid } from "uuid";

// ─── Font options ──────────────────────────────────────────────────────────────
const FONT_OPTIONS = [
  { label: "Default", value: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" },
  { label: "Georgia", value: "Georgia,'Times New Roman',serif" },
  { label: "Garamond", value: "Garamond,'Times New Roman',serif" },
  { label: "Palatino", value: "'Palatino Linotype',Palatino,serif" },
  { label: "Arial", value: "Arial,Helvetica,sans-serif" },
  { label: "Verdana", value: "Verdana,Geneva,sans-serif" },
  { label: "Trebuchet", value: "'Trebuchet MS',Helvetica,sans-serif" },
];

const MERGE_TOKENS = [
  { key: "firstName",    label: "First Name" },
  { key: "lastName",     label: "Last Name" },
  { key: "fullName",     label: "Full Name" },
  { key: "staffPOC",     label: "Staff POC" },
  { key: "eventName",    label: "Event Name" },
  { key: "eventDate",    label: "Event Date" },
  { key: "eventLocation",label: "Venue" },
  { key: "rsvpLink",     label: "RSVP Link" },
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
    left:  { type: "text", content: "Left column.", fontSize: 14, color: "#1A202C", align: "left", src: "", alt: "", link: "", label: "Learn More", url: "{{rsvpLink}}", bgColor: "#1B2B6B", textColor: "#FFFFFF", borderRadius: 6 },
    right: { type: "text", content: "Right column.", fontSize: 14, color: "#1A202C", align: "left", src: "", alt: "", link: "", label: "Learn More", url: "{{rsvpLink}}", bgColor: "#1B2B6B", textColor: "#FFFFFF", borderRadius: 6 },
    forParts: [],
  },
  callout: { content: "Important note for your guests.", bgColor: "#EFF6FF", borderColor: "#1B2B6B", textColor: "#0F1A45", fontSize: 14, icon: "ℹ️", forParts: [] },
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
      if (!guestInvitedParts || !guestInvitedParts.length) return true;
      return b.forParts.some((pid) => guestInvitedParts.includes(pid));
    })
    .map((b) => blockToHtml(b, r, event, guestInvitedParts))
    .join("\n");
}

function fmt24(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
}

function colHtml(col, r) {
  if (col.type === "image") {
    if (!col.src) return `<div style="color:#94A0B8;font-size:12px;text-align:center;">[Image]</div>`;
    const img = `<img src="${col.src}" alt="${col.alt || ""}" style="max-width:100%;display:block;border:0;" />`;
    return col.link ? `<a href="${r(col.link)}" style="text-decoration:none;">${img}</a>` : img;
  }
  if (col.type === "button") {
    return `<div style="text-align:${col.align || "center"};"><a href="${r(col.url || "")}" style="display:inline-block;background:${col.bgColor};color:${col.textColor};padding:9px 20px;border-radius:${col.borderRadius || 6}px;text-decoration:none;font-weight:700;font-size:${col.fontSize || 14}px;">${r(col.label || "Button")}</a></div>`;
  }
  return `<div style="font-size:${col.fontSize || 14}px;color:${col.color || "#1A202C"};text-align:${col.align || "left"};line-height:1.6;">${r(col.content || "")}</div>`;
}

function blockToHtml(b, r, event, guestInvitedParts) {
  switch (b.type) {
    case "text":
    case "heading": {
      const tag = b.type === "heading" ? "h2" : "p";
      const ff = b.fontFamily || FONT_OPTIONS[0].value;
      return `<${tag} style="font-size:${b.fontSize}px;color:${b.color};text-align:${b.align};font-family:${ff};margin:0 0 8px;padding:0;line-height:1.7;">${r(b.content || "")}</${tag}>`;
    }
    case "image": {
      if (!b.src) return `<div style="text-align:${b.align};padding:8px 0;color:#94A0B8;font-size:13px;">[Image]</div>`;
      const img = `<img src="${b.src}" alt="${b.alt || ""}" width="${b.width || "100%"}" style="display:block;max-width:100%;border:0;" />`;
      return `<div style="text-align:${b.align};padding:4px 0;">${b.link ? `<a href="${r(b.link)}" style="text-decoration:none;">${img}</a>` : img}</div>`;
    }
    case "button": {
      const url = r(b.url || "{{rsvpLink}}");
      const label = r(b.label || "RSVP Now");
      const br = b.borderRadius ?? 8;
      return `<div style="text-align:${b.align || "center"};margin:12px 0 4px;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="${Math.round((br / 22) * 100)}%" strokecolor="${b.bgColor}" fillcolor="${b.bgColor}"><w:anchorlock/><center style="color:${b.textColor};font-family:sans-serif;font-size:${b.fontSize ?? 15}px;font-weight:700;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${url}" style="display:inline-block;background:${b.bgColor};color:${b.textColor};padding:12px 28px;border-radius:${br}px;text-decoration:none;font-weight:700;font-size:${b.fontSize ?? 15}px;letter-spacing:0.01em;mso-hide:all;">${label}</a><!--<![endif]-->
</div>`;
    }
    case "columns":
      return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0;"><tr><td width="48%" valign="top" style="padding-right:10px;">${colHtml(b.left || {}, r)}</td><td width="4%"/><td width="48%" valign="top" style="padding-left:10px;">${colHtml(b.right || {}, r)}</td></tr></table>`;
    case "callout":
      return `<div style="background:${b.bgColor||"#EFF6FF"};border-left:4px solid ${b.borderColor||"#1B2B6B"};padding:14px 16px;border-radius:6px;margin:8px 0;"><div style="font-size:${b.fontSize||14}px;color:${b.textColor||"#0F1A45"};line-height:1.6;">${b.icon?`${b.icon} `:""}${r(b.content||"")}</div></div>`;
    case "list": {
      const tag = b.style === "numbered" ? "ol" : "ul";
      return `<${tag} style="font-size:${b.fontSize||14}px;color:${b.color||"#1A202C"};padding-left:20px;margin:4px 0 8px;">${(b.items||[]).map((item) => `<li style="margin-bottom:4px;">${r(item)}</li>`).join("")}</${tag}>`;
    }
    case "event": {
      if (!event) return "";
      const dateStr = event.date ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "";
      const parts = (event.parts || []).filter((p) => p.name && (!guestInvitedParts?.length || guestInvitedParts.includes(p.id)));
      return `<div style="background:${b.bgColor||"#F8FAFF"};border:1.5px solid ${b.borderColor||"#1B2B6B"};border-radius:8px;padding:16px 20px;margin:8px 0;"><div style="font-weight:700;font-size:16px;color:#0F1A45;margin-bottom:8px;">${event.name||""}</div>${b.showDate&&dateStr?`<div style="font-size:14px;color:#1A202C;margin-bottom:4px;">📅 ${dateStr}</div>`:""}${b.showLocation&&event.location?`<div style="font-size:14px;color:#1A202C;margin-bottom:4px;">📍 ${event.location}</div>`:""}${b.showParts&&parts.length?parts.map((p) => `<div style="font-size:13px;color:#4A5568;margin-top:2px;">· ${p.name}${p.startTime?": "+fmt24(p.startTime):""}${p.endTime?" – "+fmt24(p.endTime):""}</div>`).join(""):""}</div>`;
    }
    case "divider": return `<div style="margin:${b.marginTop??12}px 0 ${b.marginBottom??12}px;"><hr style="border:none;border-top:${b.thickness??1}px solid ${b.color??"#E4E8F0"};margin:0;"/></div>`;
    case "spacer":  return `<div style="height:${b.height??24}px;font-size:1px;line-height:1px;">&nbsp;</div>`;
    default: return "";
  }
}

// ─── ContentEditable component ─────────────────────────────────────────────────
function ContentEditable({ value, onChange, style, placeholder, className }) {
  const ref = useRef(null);
  const isFocused = useRef(false);

  // Sync from React → DOM only when not focused (to avoid caret jumping)
  useEffect(() => {
    if (ref.current && !isFocused.current) {
      if (ref.current.innerHTML !== (value || "")) {
        ref.current.innerHTML = value || "";
      }
    }
  }, [value]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className={className}
      data-placeholder={placeholder}
      onFocus={() => { isFocused.current = true; }}
      onBlur={() => {
        isFocused.current = false;
        if (ref.current) onChange(ref.current.innerHTML);
      }}
      onInput={() => { if (ref.current) onChange(ref.current.innerHTML); }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ outline: "none", cursor: "text", ...style }}
    />
  );
}

// ─── Inline floating toolbar ───────────────────────────────────────────────────
function InlineToolbar({ block, onUpdate }) {
  const set = (field, val) => onUpdate({ ...block, [field]: val });

  const exec = (cmd, val) => {
    document.execCommand(cmd, false, val || null);
  };

  const insertToken = (token) => {
    const fullToken = `{{${token}}}`;
    document.execCommand("insertText", false, fullToken);
  };

  const insertLink = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      const url = prompt("Enter link URL:");
      if (url) document.execCommand("createLink", false, url);
    } else {
      const url = prompt("Enter link URL:", "https://");
      if (url) document.execCommand("createLink", false, url);
    }
  };

  const btnStyle = (active) => ({
    width: 28, height: 26, border: "none", borderRadius: 4, cursor: "pointer",
    background: active ? "var(--navy)" : "transparent",
    color: active ? "white" : "var(--gray-600)",
    fontSize: "0.8125rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  });

  const divider = <div style={{ width: 1, height: 18, background: "var(--gray-200)", margin: "0 3px" }} />;

  return (
    <div
      onMouseDown={(e) => e.preventDefault()} // prevent losing selection
      style={{ display: "flex", alignItems: "center", gap: "2px", flexWrap: "wrap", padding: "4px 8px", background: "var(--white)", border: "1.5px solid var(--gray-200)", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,.12)", marginBottom: 6 }}>

      {/* Text format */}
      <button style={btnStyle()} onClick={() => exec("bold")} title="Bold"><b>B</b></button>
      <button style={{ ...btnStyle(), fontStyle: "italic" }} onClick={() => exec("italic")} title="Italic"><i>I</i></button>
      <button style={{ ...btnStyle(), textDecoration: "underline" }} onClick={() => exec("underline")} title="Underline"><u>U</u></button>
      <button style={btnStyle()} onClick={insertLink} title="Insert link">🔗</button>

      {divider}

      {/* Font size */}
      <select value={block.fontSize || 15} onChange={(e) => set("fontSize", parseInt(e.target.value))}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ fontSize: "0.75rem", border: "1px solid var(--gray-200)", borderRadius: 4, padding: "2px 4px", height: 26, background: "white", color: "var(--gray-700)", cursor: "pointer" }}>
        {[10,11,12,13,14,15,16,18,20,22,24,28,32,36,42,48].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      {/* Color */}
      <input type="color" value={block.color || "#1A202C"}
        onChange={(e) => set("color", e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        title="Text color"
        style={{ width: 26, height: 26, border: "1px solid var(--gray-200)", borderRadius: 4, cursor: "pointer", padding: 2 }} />

      {/* Font family */}
      <select value={block.fontFamily || FONT_OPTIONS[0].value} onChange={(e) => set("fontFamily", e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ fontSize: "0.72rem", border: "1px solid var(--gray-200)", borderRadius: 4, padding: "2px 4px", height: 26, background: "white", color: "var(--gray-700)", cursor: "pointer", maxWidth: 90 }}>
        {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      {divider}

      {/* Alignment */}
      {["left","center","right"].map((a) => (
        <button key={a} style={btnStyle((block.align || "left") === a)} onClick={() => set("align", a)} title={`Align ${a}`}>
          {a === "left" ? "⬅" : a === "center" ? "↔" : "➡"}
        </button>
      ))}

      {divider}

      {/* Merge tokens */}
      <span style={{ fontSize: "0.65rem", color: "var(--gray-400)", fontWeight: 600, marginRight: 2 }}>Insert:</span>
      {MERGE_TOKENS.map((t) => (
        <button key={t.key} style={{ ...btnStyle(), width: "auto", padding: "0 5px", fontSize: "0.62rem", color: "var(--navy)", background: "var(--navy-xlight)", border: "1px solid var(--navy-light)" }}
          onClick={() => insertToken(t.key)} title={t.label}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Block content with inline editing ─────────────────────────────────────────
function BlockContent({ block, selected, onUpdate, event }) {
  const set = (field, val) => onUpdate({ ...block, [field]: val });
  const setCol = (side, field, val) => onUpdate({ ...block, [side]: { ...block[side], [field]: val } });

  const textStyle = (b) => ({
    fontSize: Math.min(b.fontSize ?? 15, 26),
    color: b.color,
    textAlign: b.align,
    fontFamily: b.fontFamily || "inherit",
    lineHeight: 1.7,
    minHeight: b.type === "heading" ? 36 : 48,
    padding: "4px 0",
    wordBreak: "break-word",
  });

  switch (block.type) {
    case "text":
    case "heading":
      return (
        <div>
          {selected && <InlineToolbar block={block} onUpdate={onUpdate} />}
          {selected ? (
            <ContentEditable
              value={block.content}
              onChange={(v) => set("content", v)}
              style={textStyle(block)}
              placeholder={`Type your ${block.type}...`}
              className="designer-editable"
            />
          ) : (
            <div style={{ ...textStyle(block), cursor: "text" }}>
              {block.content
                ? <span dangerouslySetInnerHTML={{ __html: block.content }} />
                : <span style={{ color: "var(--gray-300)", fontStyle: "italic" }}>Click to edit {block.type}…</span>}
            </div>
          )}
        </div>
      );

    case "image":
      return block.src
        ? <div style={{ textAlign: block.align, padding: "4px 0" }}><img src={block.src} alt={block.alt || ""} style={{ maxWidth: "100%", maxHeight: 140, display: "inline-block" }} /></div>
        : <div style={{ textAlign: "center", padding: "14px", background: "var(--gray-50)", border: "2px dashed var(--gray-200)", borderRadius: 6, color: "var(--gray-400)", fontSize: 13 }}>🖼 Add image URL in settings panel →</div>;

    case "button":
      return (
        <div>
          {selected && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", background: "var(--white)", border: "1.5px solid var(--gray-200)", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,.12)", padding: "4px 8px" }}
                onMouseDown={(e) => e.preventDefault()}>
                <span style={{ fontSize: "0.65rem", color: "var(--gray-400)", fontWeight: 600, alignSelf: "center" }}>Label:</span>
                <input value={block.label || ""} onChange={(e) => set("label", e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                  placeholder="Button text" style={{ border: "none", outline: "none", fontSize: "0.875rem", fontWeight: 600, minWidth: 80 }} />
                <div style={{ width: 1, height: 18, background: "var(--gray-200)", alignSelf: "center" }} />
                <span style={{ fontSize: "0.65rem", color: "var(--gray-400)", fontWeight: 600, alignSelf: "center" }}>Color:</span>
                <input type="color" value={block.bgColor || "#1B2B6B"} onChange={(e) => set("bgColor", e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                  style={{ width: 24, height: 24, border: "1px solid var(--gray-200)", borderRadius: 4, cursor: "pointer", padding: 2 }} />
                <input type="color" value={block.textColor || "#FFFFFF"} onChange={(e) => set("textColor", e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                  title="Text color"
                  style={{ width: 24, height: 24, border: "1px solid var(--gray-200)", borderRadius: 4, cursor: "pointer", padding: 2 }} />
                <div style={{ width: 1, height: 18, background: "var(--gray-200)", alignSelf: "center" }} />
                {["left","center","right"].map((a) => (
                  <button key={a} onMouseDown={(e) => e.preventDefault()} onClick={() => set("align", a)}
                    style={{ width: 24, height: 24, border: "none", borderRadius: 4, cursor: "pointer", background: (block.align||"center") === a ? "var(--navy)" : "transparent", color: (block.align||"center") === a ? "white" : "var(--gray-500)", fontSize: "0.75rem" }}>
                    {a === "left" ? "⬅" : a === "center" ? "↔" : "➡"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ textAlign: block.align || "center", padding: "6px 0" }}>
            <span style={{ display: "inline-block", background: block.bgColor, color: block.textColor, padding: "9px 22px", borderRadius: block.borderRadius ?? 8, fontWeight: 700, fontSize: block.fontSize ?? 15 }}>
              {block.label || "RSVP Now"}
            </span>
          </div>
        </div>
      );

    case "columns": {
      const renderCol = (side) => {
        const col = block[side] || {};
        return (
          <div style={{ flex: 1, border: selected ? "1px solid var(--gray-200)" : "none", borderRadius: 5, padding: selected ? "6px" : 0 }}>
            {selected && (
              <div style={{ marginBottom: "0.25rem", display: "flex", gap: "0.25rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "var(--gray-400)", textTransform: "uppercase" }}>{side.toUpperCase()}</span>
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
              <ContentEditable value={col.content} onChange={(v) => setCol(side, "content", v)} style={{ fontSize: 13, color: col.color || "#1A202C", minHeight: 40 }} placeholder="Column text…" className="designer-editable" />
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
                <input className="form-input" style={{ fontSize: "0.75rem" }} value={col.url || ""} onChange={(e) => setCol(side, "url", e.target.value)} placeholder="{{rsvpLink}}" />
              </div>
            )}
            {!selected && (
              col.type === "image"
                ? col.src ? <img src={col.src} alt="" style={{ maxWidth: "100%", maxHeight: 60, display: "block" }} /> : <div style={{ color: "var(--gray-300)", fontSize: 11, textAlign: "center", padding: 8 }}>🖼 Image</div>
                : col.type === "button"
                  ? <div style={{ textAlign: "center" }}><span style={{ display: "inline-block", background: col.bgColor || "#1B2B6B", color: col.textColor || "#FFF", padding: "5px 14px", borderRadius: 6, fontWeight: 700, fontSize: 12 }}>{col.label || "Button"}</span></div>
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
      return (
        <div>
          {selected && <InlineToolbar block={block} onUpdate={onUpdate} />}
          <div style={{ background: block.bgColor || "#EFF6FF", borderLeft: `4px solid ${block.borderColor || "#1B2B6B"}`, padding: "10px 12px", borderRadius: 6 }}>
            {selected ? (
              <div style={{ display: "flex", gap: "0.375rem", alignItems: "flex-start" }}>
                <input value={block.icon || ""} onChange={(e) => set("icon", e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                  style={{ width: 32, border: "none", background: "transparent", fontSize: 16, outline: "none" }} />
                <ContentEditable value={block.content} onChange={(v) => set("content", v)}
                  style={{ flex: 1, fontSize: block.fontSize || 14, color: block.textColor || "#0F1A45", minHeight: 32 }}
                  placeholder="Callout text…" className="designer-editable" />
              </div>
            ) : (
              <div style={{ fontSize: block.fontSize || 14, color: block.textColor || "#0F1A45", lineHeight: 1.6 }}>
                {block.icon && <span style={{ marginRight: 6 }}>{block.icon}</span>}
                {block.content ? <span dangerouslySetInnerHTML={{ __html: block.content }} /> : <span style={{ color: "var(--gray-300)", fontStyle: "italic" }}>Click to edit callout…</span>}
              </div>
            )}
          </div>
        </div>
      );

    case "list":
      return selected ? (
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
      ) : (
        <div style={{ fontSize: 13, color: block.color || "#1A202C", lineHeight: 1.7 }}>
          {(block.items || []).map((item, i) => <div key={i}>{block.style === "numbered" ? `${i + 1}. ` : "• "}{item}</div>)}
          {(!block.items || !block.items.length) && <span style={{ color: "var(--gray-300)", fontStyle: "italic" }}>Click to edit list items…</span>}
        </div>
      );

    case "event":
      return (
        <div style={{ background: block.bgColor || "#F8FAFF", border: `1.5px solid ${block.borderColor || "#1B2B6B"}`, borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#0F1A45", marginBottom: 6 }}>{event?.name || "Event Name"}</div>
          {block.showDate && event?.date && <div style={{ fontSize: 13, color: "#1A202C", marginBottom: 3 }}>📅 {(event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>}
          {block.showLocation && event?.location && <div style={{ fontSize: 13, color: "#1A202C", marginBottom: 3 }}>📍 {event.location}</div>}
          {block.showParts && (event?.parts || []).filter((p) => p.name).map((p, i) => <div key={i} style={{ fontSize: 12, color: "#4A5568", marginTop: 2 }}>· {p.name}{p.startTime ? ": " + fmt24(p.startTime) : ""}{p.endTime ? " – " + fmt24(p.endTime) : ""}</div>)}
        </div>
      );

    case "divider":
      return <div style={{ margin: "8px 0" }}><hr style={{ border: "none", borderTop: `${block.thickness ?? 1}px solid ${block.color ?? "#E4E8F0"}`, margin: 0 }} /></div>;

    case "spacer":
      return <div style={{ height: Math.max(8, (block.height ?? 24) / 2), background: "repeating-linear-gradient(45deg,transparent,transparent 4px,var(--gray-100) 4px,var(--gray-100) 8px)", borderRadius: 3, margin: "2px 0" }} />;

    default: return null;
  }
}

// ─── Settings panel — only for non-text settings ───────────────────────────────
function SettingsPanel({ block, onChange, event }) {
  if (!block) return (
    <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--gray-400)", fontSize: "0.875rem" }}>
      <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>👆</div>
      Click any block to edit.<br />
      <span style={{ fontSize: "0.8rem" }}>A formatting bar will appear for text blocks.</span>
    </div>
  );

  const set = (field, val) => onChange({ ...block, [field]: val });

  const inp = (label, field, placeholder = "") => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <input className="form-input" style={{ fontSize: "0.8rem" }} value={block[field] ?? ""} onChange={(e) => set(field, e.target.value)} placeholder={placeholder} />
    </div>
  );

  const colorInp = (label, field) => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
        <input type="color" value={block[field] || "#000000"} onChange={(e) => set(field, e.target.value)} style={{ width: 32, height: 28, border: "1px solid var(--gray-200)", borderRadius: 5, cursor: "pointer", padding: 2 }} />
        <input type="text" value={block[field] || ""} onChange={(e) => set(field, e.target.value)} style={{ flex: 1, padding: "0.25rem 0.5rem", border: "1.5px solid var(--gray-200)", borderRadius: 5, fontSize: "0.75rem", fontFamily: "monospace" }} />
      </div>
    </div>
  );

  const numInp = (label, field, min, max, def) => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input type="range" min={min} max={max} value={block[field] ?? def} onChange={(e) => set(field, parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--navy)" }} />
        <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: 28 }}>{block[field] ?? def}</span>
      </div>
    </div>
  );

  const title = (t) => <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "0.875rem", fontSize: "0.875rem", borderBottom: "1px solid var(--gray-100)", paddingBottom: "0.5rem" }}>{t}</div>;

  const forPartsSection = () => {
    if (!event || (event.parts || []).length <= 1) return null;
    return (
      <div style={{ marginTop: "0.875rem", paddingTop: "0.875rem", borderTop: "1px solid var(--gray-100)" }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.375rem" }}>Show only to guests invited to</div>
        <div style={{ fontSize: "0.72rem", color: "var(--gray-400)", marginBottom: "0.375rem" }}>Leave unchecked to show to everyone.</div>
        {event.parts.map((p) => (
          <label key={p.id} className="checkbox-label" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
            <input type="checkbox" checked={(block.forParts || []).includes(p.id)}
              onChange={() => set("forParts", (block.forParts || []).includes(p.id) ? (block.forParts || []).filter((x) => x !== p.id) : [...(block.forParts || []), p.id])} />
            {p.name}
          </label>
        ))}
        {(block.forParts || []).length > 0 && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: "var(--navy)", fontWeight: 600, background: "var(--navy-xlight)", padding: "3px 7px", borderRadius: 5 }}>
            ✓ {(block.forParts || []).map((pid) => event.parts.find((p) => p.id === pid)?.name).filter(Boolean).join(", ")} only
          </div>
        )}
      </div>
    );
  };

  switch (block.type) {
    case "text":
    case "heading":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title(block.type === "heading" ? "Heading" : "Text")}
          <div style={{ background: "var(--navy-xlight)", border: "1px solid var(--navy-light)", borderRadius: 6, padding: "0.5rem 0.625rem", fontSize: "0.75rem", color: "var(--navy)", marginBottom: "0.875rem" }}>
            ✏️ Click the block on the canvas to type and format. A toolbar will appear at the top of the block.
          </div>
          {forPartsSection()}
        </div>
      );
    case "image":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Image")}
          {inp("Image URL", "src", "https://...")}
          {inp("Alt Text", "alt", "Description")}
          {inp("Link URL (optional)", "link", "https://... or {{rsvpLink}}")}
          {inp("Width", "width", "100% or 300px")}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Alignment</label>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {["left","center","right"].map((a) => (
                <button key={a} onClick={() => set("align", a)}
                  style={{ flex: 1, padding: "0.3rem", border: "1.5px solid var(--gray-200)", borderRadius: 5, background: (block.align||"center") === a ? "var(--navy)" : "white", color: (block.align||"center") === a ? "white" : "var(--gray-600)", cursor: "pointer", fontSize: "0.8rem" }}>
                  {a === "left" ? "⬅" : a === "center" ? "↔" : "➡"}
                </button>
              ))}
            </div>
          </div>
          {forPartsSection()}
        </div>
      );
    case "button":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Button")}
          <div style={{ background: "var(--navy-xlight)", border: "1px solid var(--navy-light)", borderRadius: 6, padding: "0.5rem 0.625rem", fontSize: "0.75rem", color: "var(--navy)", marginBottom: "0.875rem" }}>
            ✏️ Click the block to edit the label and colors directly.
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link URL</label>
            <button type="button" onClick={() => set("url", "{{rsvpLink}}")} style={{ fontSize: "0.65rem", padding: "2px 7px", border: "1px solid var(--navy-light)", borderRadius: 4, background: "var(--navy-xlight)", color: "var(--navy)", cursor: "pointer", fontWeight: 700, marginBottom: "0.25rem" }}>Use RSVP Link ↙</button>
            <input className="form-input" style={{ fontSize: "0.8rem" }} value={block.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="{{rsvpLink}} or https://..." />
          </div>
          {numInp("Font Size", "fontSize", 10, 24, 15)}
          {numInp("Border Radius", "borderRadius", 0, 30, 8)}
          {forPartsSection()}
        </div>
      );
    case "columns":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Two Columns")}
          <p style={{ fontSize: "0.8rem", color: "var(--gray-500)", marginBottom: "0.75rem" }}>Click the block to set each column's content type and edit inline.</p>
          {forPartsSection()}
        </div>
      );
    case "callout":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Callout")}
          <div style={{ background: "var(--navy-xlight)", border: "1px solid var(--navy-light)", borderRadius: 6, padding: "0.5rem 0.625rem", fontSize: "0.75rem", color: "var(--navy)", marginBottom: "0.875rem" }}>
            ✏️ Click the block to edit text and icon directly.
          </div>
          {colorInp("Background", "bgColor")}
          {colorInp("Border Color", "borderColor")}
          {colorInp("Text Color", "textColor")}
          {forPartsSection()}
        </div>
      );
    case "list":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("List")}
          <p style={{ fontSize: "0.8rem", color: "var(--gray-500)", marginBottom: "0.75rem" }}>Click the block to add, remove and edit items directly.</p>
          {colorInp("Text Color", "color")}
          {forPartsSection()}
        </div>
      );
    case "event":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Event Details")}
          <p style={{ fontSize: "0.8rem", color: "var(--gray-500)", marginBottom: "0.75rem" }}>Auto-populated from your event. Shows only parts the recipient is invited to.</p>
          {["showDate","showLocation","showParts"].map((field) => (
            <label key={field} className="checkbox-label" style={{ marginBottom: "0.5rem", fontSize: "0.875rem" }}>
              <input type="checkbox" checked={block[field] !== false} onChange={(e) => set(field, e.target.checked)} />
              Show {field.replace("show","").replace(/([A-Z])/g," $1").trim()}
            </label>
          ))}
          {colorInp("Background", "bgColor")}
          {colorInp("Border Color", "borderColor")}
          {forPartsSection()}
        </div>
      );
    case "divider":
      return (
        <div style={{ padding: "0.875rem" }}>
          {title("Divider")}
          {colorInp("Color", "color")}
          {numInp("Thickness", "thickness", 1, 10, 1)}
          {numInp("Space Above", "marginTop", 0, 60, 12)}
          {numInp("Space Below", "marginBottom", 0, 60, 12)}
        </div>
      );
    case "spacer":
      return <div style={{ padding: "0.875rem" }}>{title("Spacer")}{numInp("Height (px)", "height", 4, 120, 24)}</div>;
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
      <span style={{ width: 18, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
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
          <div style={{ fontSize: "0.6rem", fontWeight: 700, color: "var(--navy)", background: "var(--navy-xlight)", borderRadius: 4, padding: "1px 6px", marginBottom: 4, display: "inline-block" }}>👁 {partNames} only</div>
        )}
        <BlockContent block={block} selected={selected} onUpdate={onUpdate} event={event} />
      </div>
      <button className="block-delete" onClick={(e) => { e.stopPropagation(); onDelete(block.id); }} title="Remove">✕</button>
    </div>
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
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 220px", gap: "0.875rem", minHeight: 520 }}>

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
        <div style={{ background: "#FFFFFF", borderBottom: "3px solid #1B2B6B", padding: "13px 20px", textAlign: "center", flexShrink: 0 }}>
          <img src="https://bpickert99.github.io/cspc-events/cspc-logo.png" alt="CSPC" style={{ height: 34, display: "inline-block" }} />
        </div>
        <div id="designer-canvas" style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem", minHeight: 200 }}>
          {blocks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--gray-400)", fontSize: "0.875rem", border: "2px dashed var(--gray-200)", borderRadius: 8 }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎨</div>
              Click a block type on the left to start building<br />
              <span style={{ fontSize: "0.8rem", color: "var(--gray-300)" }}>Grab ⠿ to reorder</span>
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

      {/* Settings panel */}
      <div style={{ background: "var(--white)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-lg)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "0.5rem 0.75rem", background: "var(--gray-50)", borderBottom: "1px solid var(--gray-100)", fontSize: "0.68rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Settings</div>
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
          <SettingsPanel block={selectedBlock} onChange={updateBlock} event={event} />
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
