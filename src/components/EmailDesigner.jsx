import { useState, useCallback } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { v4 as uuid } from "uuid";

// ─── Block definitions ──────────────────────────────────────────────────────────
const BLOCK_PALETTE = [
  { type: "text",     icon: "¶",  label: "Text" },
  { type: "heading",  icon: "H",  label: "Heading" },
  { type: "image",    icon: "🖼",  label: "Image" },
  { type: "button",   icon: "⬛", label: "Button" },
  { type: "divider",  icon: "—",  label: "Divider" },
  { type: "spacer",   icon: "↕",  label: "Spacer" },
  { type: "columns",  icon: "⊟",  label: "Two Columns" },
];

const DEFAULT_BLOCK = {
  text:    { content: "Your text here. Use merge fields like {{firstName}} to personalize.", fontSize: 15, color: "#1A202C", align: "left", bold: false, italic: false },
  heading: { content: "Section Heading", fontSize: 22, color: "#0F1A45", align: "center", bold: true, italic: false },
  image:   { src: "", alt: "", link: "", width: "100%", align: "center" },
  button:  { label: "RSVP Now", url: "{{rsvpLink}}", bgColor: "#1B2B6B", textColor: "#FFFFFF", align: "center", borderRadius: 8, fontSize: 15 },
  divider: { color: "#E4E8F0", thickness: 1, marginTop: 12, marginBottom: 12 },
  spacer:  { height: 24 },
  columns: { leftContent: "Left column text", rightContent: "Right column text", fontSize: 14, color: "#1A202C" },
};

export function createBlock(type) {
  return { id: uuid(), type, ...DEFAULT_BLOCK[type] };
}

// ─── HTML generation ────────────────────────────────────────────────────────────
export function blocksToHtml(blocks, resolveToken) {
  const r = resolveToken || ((s) => s);
  return blocks.map((b) => blockToHtml(b, r)).join("\n");
}

function blockToHtml(b, r) {
  switch (b.type) {
    case "text":
    case "heading": {
      const style = [
        `font-size:${b.fontSize}px`,
        `color:${b.color}`,
        `text-align:${b.align}`,
        b.bold ? "font-weight:700" : "font-weight:400",
        b.italic ? "font-style:italic" : "",
        "margin:0 0 8px;padding:0;line-height:1.6",
      ].filter(Boolean).join(";");
      const tag = b.type === "heading" ? "h2" : "p";
      return `<${tag} style="${style}">${r(b.content || "")}</${tag}>`;
    }
    case "image": {
      if (!b.src) return `<div style="text-align:${b.align};padding:8px 0;color:#94A0B8;font-size:13px;">[Image block — add a URL in settings]</div>`;
      const img = `<img src="${b.src}" alt="${b.alt || ""}" width="${b.width || "100%"}" style="display:block;max-width:100%;border:0;" />`;
      const content = b.link ? `<a href="${r(b.link)}" style="text-decoration:none;">${img}</a>` : img;
      return `<div style="text-align:${b.align};padding:4px 0;">${content}</div>`;
    }
    case "button": {
      const url = r(b.url || "{{rsvpLink}}");
      const label = r(b.label || "RSVP Now");
      const br = b.borderRadius ?? 8;
      const fs = b.fontSize ?? 15;
      return `<div style="text-align:${b.align || "center"};margin:12px 0 4px;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="${Math.round((br / 22) * 100)}%" strokecolor="${b.bgColor}" fillcolor="${b.bgColor}">
<w:anchorlock/><center style="color:${b.textColor};font-family:sans-serif;font-size:${fs}px;font-weight:700;">${label}</center>
</v:roundrect><![endif]-->
<!--[if !mso]><!-->
<a href="${url}" style="display:inline-block;background:${b.bgColor};color:${b.textColor};padding:12px 28px;border-radius:${br}px;text-decoration:none;font-weight:700;font-size:${fs}px;letter-spacing:0.01em;mso-hide:all;">${label}</a>
<!--<![endif]-->
</div>`;
    }
    case "divider":
      return `<div style="margin:${b.marginTop ?? 12}px 0 ${b.marginBottom ?? 12}px;"><hr style="border:none;border-top:${b.thickness ?? 1}px solid ${b.color ?? "#E4E8F0"};margin:0;" /></div>`;
    case "spacer":
      return `<div style="height:${b.height ?? 24}px;font-size:1px;line-height:1px;">&nbsp;</div>`;
    case "columns":
      return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>
  <td width="48%" valign="top" style="padding-right:8px;font-size:${b.fontSize ?? 14}px;color:${b.color ?? "#1A202C"};line-height:1.6;">${r(b.leftContent || "")}</td>
  <td width="4%" />
  <td width="48%" valign="top" style="padding-left:8px;font-size:${b.fontSize ?? 14}px;color:${b.color ?? "#1A202C"};line-height:1.6;">${r(b.rightContent || "")}</td>
</tr></table>`;
    default:
      return "";
  }
}

// ─── Sortable block row ─────────────────────────────────────────────────────────
function SortableBlock({ block, selected, onSelect, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style}
      onClick={() => onSelect(block.id)}
      className={selected ? "designer-block selected" : "designer-block"}>
      <div className="block-drag-handle" {...attributes} {...listeners} title="Drag to reorder">⠿</div>
      <div className="block-preview">
        <BlockPreview block={block} />
      </div>
      <button className="block-delete" onClick={(e) => { e.stopPropagation(); onDelete(block.id); }} title="Remove block">✕</button>
    </div>
  );
}

// ─── Visual preview of a block inside the canvas ───────────────────────────────
function BlockPreview({ block }) {
  switch (block.type) {
    case "text":
    case "heading":
      return (
        <div style={{ fontSize: block.type === "heading" ? 18 : 14, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? "italic" : "normal", color: block.color, textAlign: block.align, lineHeight: 1.5, padding: "6px 0", wordBreak: "break-word" }}>
          {block.content || <span style={{ color: "var(--gray-300)" }}>Empty {block.type}</span>}
        </div>
      );
    case "image":
      return block.src
        ? <div style={{ textAlign: block.align, padding: "4px 0" }}><img src={block.src} alt={block.alt || ""} style={{ maxWidth: "100%", maxHeight: 120, display: "inline-block" }} /></div>
        : <div style={{ textAlign: "center", padding: "12px", background: "var(--gray-50)", border: "2px dashed var(--gray-200)", borderRadius: 6, color: "var(--gray-400)", fontSize: 13 }}>🖼 Add image URL in settings</div>;
    case "button":
      return (
        <div style={{ textAlign: block.align || "center", padding: "6px 0" }}>
          <span style={{ display: "inline-block", background: block.bgColor, color: block.textColor, padding: "9px 22px", borderRadius: block.borderRadius ?? 8, fontWeight: 700, fontSize: block.fontSize ?? 15 }}>
            {block.label || "Button"}
          </span>
        </div>
      );
    case "divider":
      return <div style={{ margin: "8px 0" }}><hr style={{ border: "none", borderTop: `${block.thickness ?? 1}px solid ${block.color ?? "#E4E8F0"}`, margin: 0 }} /></div>;
    case "spacer":
      return <div style={{ height: Math.max(8, (block.height ?? 24) / 2), background: "repeating-linear-gradient(45deg, transparent, transparent 4px, var(--gray-100) 4px, var(--gray-100) 8px)", borderRadius: 3, margin: "2px 0" }} />;
    case "columns":
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, fontSize: 12, color: block.color, padding: "4px 6px", background: "var(--gray-50)", borderRadius: 4, minHeight: 32 }}>{block.leftContent || "Left column"}</div>
          <div style={{ flex: 1, fontSize: 12, color: block.color, padding: "4px 6px", background: "var(--gray-50)", borderRadius: 4, minHeight: 32 }}>{block.rightContent || "Right column"}</div>
        </div>
      );
    default:
      return null;
  }
}

// ─── Settings panel for selected block ─────────────────────────────────────────
function BlockSettings({ block, onChange }) {
  if (!block) return (
    <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--gray-400)", fontSize: "0.875rem" }}>
      <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>👆</div>
      Click any block to edit its settings
    </div>
  );

  const set = (field, val) => onChange({ ...block, [field]: val });

  const colorInput = (label, field) => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="color" value={block[field] || "#000000"} onChange={(e) => set(field, e.target.value)} style={{ width: 36, height: 32, border: "1px solid var(--gray-200)", borderRadius: 6, cursor: "pointer", padding: 2 }} />
        <input type="text" value={block[field] || ""} onChange={(e) => set(field, e.target.value)} style={{ flex: 1, padding: "0.375rem 0.5rem", border: "1.5px solid var(--gray-200)", borderRadius: 6, fontSize: "0.875rem", fontFamily: "monospace" }} />
      </div>
    </div>
  );

  const textInput = (label, field, placeholder = "") => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <input className="form-input" value={block[field] ?? ""} onChange={(e) => set(field, e.target.value)} placeholder={placeholder} />
    </div>
  );

  const numInput = (label, field, min, max) => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input type="range" min={min} max={max} value={block[field] ?? 15} onChange={(e) => set(field, parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--navy)" }} />
        <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--gray-600)", minWidth: 28, textAlign: "right" }}>{block[field] ?? 15}</span>
      </div>
    </div>
  );

  const alignButtons = (field = "align") => (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Alignment</label>
      <div style={{ display: "flex", gap: "0.25rem" }}>
        {["left", "center", "right"].map((a) => (
          <button key={a} onClick={() => set(field, a)}
            style={{ flex: 1, padding: "0.375rem", border: "1.5px solid var(--gray-200)", borderRadius: 6, background: block[field] === a ? "var(--navy)" : "white", color: block[field] === a ? "white" : "var(--gray-600)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
            {a === "left" ? "⬅" : a === "center" ? "↔" : "➡"}
          </button>
        ))}
      </div>
    </div>
  );

  const MERGE_TOKENS = ["{{firstName}}", "{{lastName}}", "{{fullName}}", "{{staffPOC}}", "{{eventName}}", "{{eventDate}}", "{{eventLocation}}", "{{rsvpLink}}"];

  const mergeHelper = (field) => (
    <div style={{ marginBottom: "0.5rem" }}>
      <div style={{ fontSize: "0.7rem", color: "var(--gray-400)", marginBottom: "0.25rem" }}>Insert merge field:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
        {MERGE_TOKENS.map((t) => (
          <button key={t} onClick={() => set(field, (block[field] || "") + t)}
            style={{ fontSize: "0.65rem", padding: "0.125rem 0.375rem", border: "1px solid var(--gray-200)", borderRadius: 4, background: "var(--gray-50)", cursor: "pointer", color: "var(--navy)", fontWeight: 600 }}>
            {t.replace(/[{}]/g, "")}
          </button>
        ))}
      </div>
    </div>
  );

  switch (block.type) {
    case "text":
    case "heading":
      return (
        <div style={{ padding: "1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "1rem", fontSize: "0.875rem", borderBottom: "1px solid var(--gray-100)", paddingBottom: "0.625rem" }}>
            {block.type === "heading" ? "Heading" : "Text"} Settings
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Content</label>
            {mergeHelper("content")}
            <textarea className="form-textarea" value={block.content || ""} onChange={(e) => set("content", e.target.value)} style={{ minHeight: 90, fontSize: "0.875rem" }} />
          </div>
          {numInput("Font Size", "fontSize", 10, 48)}
          {colorInput("Color", "color")}
          {alignButtons()}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <button onClick={() => set("bold", !block.bold)}
              style={{ flex: 1, padding: "0.375rem", border: "1.5px solid var(--gray-200)", borderRadius: 6, background: block.bold ? "var(--navy)" : "white", color: block.bold ? "white" : "var(--gray-600)", cursor: "pointer", fontWeight: 700 }}>B</button>
            <button onClick={() => set("italic", !block.italic)}
              style={{ flex: 1, padding: "0.375rem", border: "1.5px solid var(--gray-200)", borderRadius: 6, background: block.italic ? "var(--navy)" : "white", color: block.italic ? "white" : "var(--gray-600)", cursor: "pointer", fontStyle: "italic" }}>I</button>
          </div>
        </div>
      );

    case "image":
      return (
        <div style={{ padding: "1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "1rem", fontSize: "0.875rem", borderBottom: "1px solid var(--gray-100)", paddingBottom: "0.625rem" }}>Image Settings</div>
          {textInput("Image URL", "src", "https://...")}
          {textInput("Alt Text", "alt", "Image description")}
          {textInput("Link URL (optional)", "link", "https://... or {{rsvpLink}}")}
          {textInput("Width", "width", "100% or 300px")}
          {alignButtons()}
        </div>
      );

    case "button":
      return (
        <div style={{ padding: "1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "1rem", fontSize: "0.875rem", borderBottom: "1px solid var(--gray-100)", paddingBottom: "0.625rem" }}>Button Settings</div>
          {textInput("Label", "label", "RSVP Now")}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link URL</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "0.375rem" }}>
              {["{{rsvpLink}}", "{{eventLocation}}"].map((t) => (
                <button key={t} onClick={() => set("url", t)} style={{ fontSize: "0.65rem", padding: "0.125rem 0.375rem", border: "1px solid var(--gray-200)", borderRadius: 4, background: "var(--gray-50)", cursor: "pointer", color: "var(--navy)", fontWeight: 600 }}>{t.replace(/[{}]/g, "")}</button>
              ))}
            </div>
            <input className="form-input" value={block.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="{{rsvpLink}} or https://..." />
          </div>
          {colorInput("Button Color", "bgColor")}
          {colorInput("Text Color", "textColor")}
          {numInput("Font Size", "fontSize", 10, 24)}
          {numInput("Border Radius", "borderRadius", 0, 30)}
          {alignButtons()}
        </div>
      );

    case "divider":
      return (
        <div style={{ padding: "1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "1rem", fontSize: "0.875rem", borderBottom: "1px solid var(--gray-100)", paddingBottom: "0.625rem" }}>Divider Settings</div>
          {colorInput("Color", "color")}
          {numInput("Thickness (px)", "thickness", 1, 10)}
          {numInput("Space Above (px)", "marginTop", 0, 60)}
          {numInput("Space Below (px)", "marginBottom", 0, 60)}
        </div>
      );

    case "spacer":
      return (
        <div style={{ padding: "1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "1rem", fontSize: "0.875rem", borderBottom: "1px solid var(--gray-100)", paddingBottom: "0.625rem" }}>Spacer Settings</div>
          {numInput("Height (px)", "height", 4, 120)}
        </div>
      );

    case "columns":
      return (
        <div style={{ padding: "1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "1rem", fontSize: "0.875rem", borderBottom: "1px solid var(--gray-100)", paddingBottom: "0.625rem" }}>Two Column Settings</div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Left Column</label>
            {mergeHelper("leftContent")}
            <textarea className="form-textarea" value={block.leftContent || ""} onChange={(e) => set("leftContent", e.target.value)} style={{ minHeight: 70, fontSize: "0.875rem" }} />
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Right Column</label>
            {mergeHelper("rightContent")}
            <textarea className="form-textarea" value={block.rightContent || ""} onChange={(e) => set("rightContent", e.target.value)} style={{ minHeight: 70, fontSize: "0.875rem" }} />
          </div>
          {numInput("Font Size", "fontSize", 10, 24)}
          {colorInput("Text Color", "color")}
        </div>
      );

    default:
      return null;
  }
}

// ─── Palette item (draggable from palette to canvas) ───────────────────────────
function PaletteItem({ type, icon, label }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette-${type}` });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1.5px solid var(--gray-200)", background: isDragging ? "var(--navy-light)" : "white", cursor: "grab", userSelect: "none", marginBottom: "0.375rem", transition: "all 0.15s", fontSize: "0.8125rem", fontWeight: 600, color: "var(--gray-700)", boxShadow: isDragging ? "var(--shadow-md)" : "var(--shadow-xs)" }}
      onMouseEnter={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = "var(--navy)"; e.currentTarget.style.background = "var(--navy-xlight)"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--gray-200)"; e.currentTarget.style.background = "white"; }}>
      <span style={{ fontSize: "1rem", width: 20, textAlign: "center" }}>{icon}</span>
      {label}
    </div>
  );
}

// ─── Canvas drop zone ──────────────────────────────────────────────────────────
function CanvasDropZone({ children, isEmpty }) {
  const { isOver, setNodeRef } = useDroppable({ id: "canvas" });
  return (
    <div ref={setNodeRef} style={{ minHeight: 120, background: isOver ? "var(--navy-light)" : isEmpty ? "var(--gray-50)" : "transparent", border: isOver ? "2px dashed var(--navy)" : isEmpty ? "2px dashed var(--gray-200)" : "none", borderRadius: 8, transition: "all 0.15s", padding: isEmpty ? "2rem" : 0 }}>
      {isEmpty
        ? <div style={{ textAlign: "center", color: "var(--gray-400)", fontSize: "0.875rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎨</div>
            Drag blocks from the left panel to build your email
          </div>
        : children}
    </div>
  );
}

// ─── Main EmailDesigner component ──────────────────────────────────────────────
export default function EmailDesigner({ blocks, onChange, subject, onSubjectChange, buttonText, onButtonTextChange }) {
  const [selectedId, setSelectedId] = useState(null);
  const [activeDragId, setActiveDragId] = useState(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const selectedBlock = blocks.find((b) => b.id === selectedId);

  const addBlock = useCallback((type, insertAfter = null) => {
    const newBlock = createBlock(type);
    onChange((prev) => {
      if (insertAfter === null) return [...prev, newBlock];
      const idx = prev.findIndex((b) => b.id === insertAfter);
      const next = [...prev];
      next.splice(idx + 1, 0, newBlock);
      return next;
    });
    setSelectedId(newBlock.id);
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
    const copy = { ...block, id: uuid() };
    onChange((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setSelectedId(copy.id);
  }, [blocks, onChange]);

  const onDragStart = ({ active }) => setActiveDragId(active.id);

  const onDragEnd = ({ active, over }) => {
    setActiveDragId(null);
    if (!over) return;

    const isPalette = String(active.id).startsWith("palette-");

    if (isPalette) {
      // Adding a new block from palette
      const type = String(active.id).replace("palette-", "");
      if (over.id === "canvas" || blocks.some((b) => b.id === over.id)) {
        const insertAfter = over.id === "canvas" ? null : over.id;
        addBlock(type, insertAfter);
      }
    } else {
      // Reordering existing blocks
      if (active.id !== over.id) {
        onChange((prev) => {
          const oldIndex = prev.findIndex((b) => b.id === active.id);
          const newIndex = prev.findIndex((b) => b.id === over.id);
          return arrayMove(prev, oldIndex, newIndex);
        });
      }
    }
  };

  const activePaletteType = activeDragId?.startsWith?.("palette-") ? activeDragId.replace("palette-", "") : null;
  const activePaletteDef = activePaletteType ? BLOCK_PALETTE.find((p) => p.type === activePaletteType) : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 240px", gap: "1rem", minHeight: 500 }}>

      {/* ─── Left: palette ─── */}
      <div style={{ background: "var(--white)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "0.75rem 0.875rem", background: "var(--gray-50)", borderBottom: "1px solid var(--gray-100)", fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Blocks
        </div>
        <div style={{ padding: "0.625rem" }}>
          {BLOCK_PALETTE.map((p) => <PaletteItem key={p.type} {...p} />)}
        </div>
      </div>

      {/* ─── Middle: canvas ─── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div style={{ background: "var(--white)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-lg)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Email chrome */}
          <div style={{ background: "#0F1A45", padding: "16px 20px", textAlign: "center" }}>
            <img src="https://bpickert99.github.io/cspc-events/cspc-logo.png" alt="CSPC" style={{ height: 32, filter: "brightness(0) invert(1)", display: "inline-block" }} />
          </div>

          <div style={{ padding: "1rem 1.25rem", flex: 1 }}>
            <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <CanvasDropZone isEmpty={blocks.length === 0}>
                {blocks.map((block) => (
                  <SortableBlock
                    key={block.id}
                    block={block}
                    selected={selectedId === block.id}
                    onSelect={setSelectedId}
                    onDelete={deleteBlock}
                  />
                ))}
              </CanvasDropZone>
            </SortableContext>
          </div>

          {/* Footer chrome */}
          <div style={{ background: "#F6F8FC", borderTop: "1px solid #E4E8F0", padding: "10px 20px", textAlign: "center", fontSize: 11, color: "#94A0B8" }}>
            Center for the Study of the Presidency and Congress · Washington, D.C.<br />
            601 13th Street NW, Suite 940N, Washington, DC 20005
          </div>
        </div>

        <DragOverlay>
          {activePaletteDef && (
            <div style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1.5px solid var(--navy)", background: "var(--navy-light)", fontSize: "0.8125rem", fontWeight: 600, color: "var(--navy)", boxShadow: "var(--shadow-md)", cursor: "grabbing" }}>
              {activePaletteDef.icon} {activePaletteDef.label}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* ─── Right: settings ─── */}
      <div style={{ background: "var(--white)", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-lg)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "0.75rem 0.875rem", background: "var(--gray-50)", borderBottom: "1px solid var(--gray-100)", fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Settings
        </div>

        {/* Subject and button text always shown */}
        <div style={{ padding: "0.75rem", borderBottom: "1px solid var(--gray-100)" }}>
          <div style={{ marginBottom: "0.625rem" }}>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Subject</label>
            <input className="form-input" style={{ fontSize: "0.8125rem" }} value={subject || ""} onChange={(e) => onSubjectChange(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Default Button Text</label>
            <input className="form-input" style={{ fontSize: "0.8125rem" }} value={buttonText || "RSVP Now"} onChange={(e) => onButtonTextChange(e.target.value)} placeholder="RSVP Now" />
          </div>
        </div>

        {/* Selected block settings */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <BlockSettings block={selectedBlock} onChange={updateBlock} />
        </div>

        {/* Block actions */}
        {selectedBlock && (
          <div style={{ padding: "0.625rem", borderTop: "1px solid var(--gray-100)", display: "flex", gap: "0.375rem" }}>
            <button className="btn btn-secondary btn-sm" style={{ flex: 1, fontSize: "0.75rem" }} onClick={() => duplicateBlock(selectedId)}>Duplicate</button>
            <button className="btn btn-danger btn-sm" style={{ flex: 1, fontSize: "0.75rem" }} onClick={() => deleteBlock(selectedId)}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}
