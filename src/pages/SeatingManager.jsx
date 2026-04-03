import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, getDocs, query, collection, where, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import * as XLSX from "xlsx";

// ─── Draggable guest chip (sidebar) ──────────────────────────────────────────
function GuestChip({ guest }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: guest.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className={`guest-chip${guest.isPlusOne ? " plus-one" : ""}`}>
      <div>
        <div className="chip-name">{guest.displayName}</div>
        {guest.isPlusOne && guest.primaryGuestName && (
          <div className="chip-meta">+1 of {guest.primaryGuestName}</div>
        )}
        {guest.dietary && <div className="chip-meta">🍽 {guest.dietary}</div>}
      </div>
      {guest.isPlusOne && <span style={{ fontSize: "0.65rem", color: "var(--gold-dark)", fontWeight: 700 }}>＋1</span>}
    </div>
  );
}

// ─── Draggable occupied seat content ─────────────────────────────────────────
function DraggableSeatOccupant({ guest, seatKey, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: guest.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : 1, cursor: "grab", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <div className="seat-guest">{guest.displayName}</div>
      {guest.isPlusOne && guest.primaryGuestName && (
        <div className="seat-plus-one-of">＋1 of {guest.primaryGuestName}</div>
      )}
    </div>
  );
}

// ─── Droppable seat slot ──────────────────────────────────────────────────────
function SeatSlot({ tableId, seatIndex, occupant, allGuests, onRemove }) {
  const { isOver, setNodeRef } = useDroppable({ id: `${tableId}__${seatIndex}` });
  const isPlusOne = occupant?.isPlusOne;
  return (
    <div ref={setNodeRef}
      className={`seat-slot${occupant ? ` occupied${isPlusOne ? " plus-one" : ""}` : ""}${isOver ? " drag-over" : ""}`}>
      <span className="seat-number">{seatIndex + 1}</span>
      {occupant ? (
        <>
          <DraggableSeatOccupant guest={occupant} seatKey={`${tableId}__${seatIndex}`} onRemove={onRemove} />
          <span className="seat-remove" onMouseDown={(e) => { e.stopPropagation(); onRemove(tableId, seatIndex); }}>✕</span>
        </>
      ) : (
        <span style={{ fontSize: "0.7125rem", color: "var(--gray-300)" }}>Empty</span>
      )}
    </div>
  );
}

export default function SeatingManager() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [tables, setTables] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggingGuest, setDraggingGuest] = useState(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    (async () => {
      const evSnap = await getDoc(doc(db, "events", id));
      if (!evSnap.exists()) return;
      setEvent({ id: evSnap.id, ...evSnap.data() });

      const guestSnap = await getDocs(query(collection(db, "guests"), where("eventId", "==", id)));
      const rawGuests = guestSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Build enriched list — declined guests excluded
      const enriched = [];
      rawGuests.forEach((g) => {
        if (g.rsvpStatus === "no") return;
        enriched.push({
          id: g.id,
          displayName: `${g.firstName} ${g.lastName}`,
          title: g.title,
          isPlusOne: false,
          primaryGuestId: null,
          primaryGuestName: null,
          dietary: g.rsvpData?.["Dietary restrictions"] || "",
          email: g.email,
        });
        // Plus ones provided by guest during RSVP
        const plusOneName = g.plusOneRsvpName || g.plusOneName;
        if ((g.plusOneRsvpStatus === "yes" || g.plusOneEligible) && plusOneName) {
          enriched.push({
            id: `${g.id}_plus1`,
            displayName: plusOneName,
            isPlusOne: true,
            primaryGuestId: g.id,
            primaryGuestName: `${g.firstName} ${g.lastName}`,
            dietary: g.rsvpData?.["Plus one dietary restrictions"] || "",
            email: "",
          });
        }
      });
      setGuests(enriched);

      const seatSnap = await getDoc(doc(db, "seating", id));
      if (seatSnap.exists()) {
        setTables(seatSnap.data().tables || []);
        setAssignments(seatSnap.data().assignments || {});
      } else {
        setTables(
          Array.from({ length: 10 }, (_, i) => ({
            id: `t${i + 1}`,
            name: i === 0 ? "Head Table" : `Table ${i}`,
            seats: 10,
            isHeadTable: i === 0,
          }))
        );
      }
      setLoading(false);
    })();
  }, [id]);

  const save = async () => {
    setSaving(true);
    await setDoc(doc(db, "seating", id), { tables, assignments, updatedAt: serverTimestamp() });
    setSaving(false);
  };

  // ─── Excel export ──────────────────────────────────────────────────────────
  const exportExcel = () => {
    const rows = [];
    tables.forEach((table) => {
      for (let i = 0; i < table.seats; i++) {
        const gid = assignments[`${table.id}__${i}`];
        const guest = gid ? guests.find((g) => g.id === gid) : null;
        rows.push({
          Table: table.name,
          Seat: i + 1,
          Name: guest ? guest.displayName : "",
          "Plus One Of": guest?.isPlusOne ? guest.primaryGuestName : "",
          "Dietary Restrictions": guest?.dietary || "",
          Email: guest?.email || "",
          Status: guest ? (guest.isPlusOne ? "Plus One" : "Guest") : "Empty",
        });
      }
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 16 }, { wch: 6 }, { wch: 28 }, { wch: 24 }, { wch: 28 }, { wch: 32 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Seating");
    XLSX.writeFile(wb, `${event?.name || "Seating"} - Seating Chart.xlsx`);
  };

  const assignedIds = new Set(Object.values(assignments));
  const unassigned = guests.filter((g) => !assignedIds.has(g.id));

  const getOccupant = (tableId, seatIdx) => {
    const gid = assignments[`${tableId}__${seatIdx}`];
    return gid ? guests.find((g) => g.id === gid) : null;
  };

  const onDragStart = ({ active }) => setDraggingGuest(guests.find((g) => g.id === active.id));

  const onDragEnd = ({ active, over }) => {
    setDraggingGuest(null);
    if (!over) return;

    // Dropped onto unassigned zone — remove from seat
    if (over.id === "__unassigned__") {
      const currentKey = Object.entries(assignments).find(([, v]) => v === active.id)?.[0];
      if (currentKey) setAssignments((prev) => { const n = { ...prev }; delete n[currentKey]; return n; });
      return;
    }

    if (!String(over.id).includes("__")) return;

    const guestId = active.id;
    const targetKey = String(over.id);
    const existingInTarget = assignments[targetKey];

    // Find where this guest currently is (could be a seat or unassigned)
    const currentKey = Object.entries(assignments).find(([, v]) => v === guestId)?.[0];

    if (existingInTarget === guestId) return; // dropped on own seat

    setAssignments((prev) => {
      const next = { ...prev };

      // If target occupied: swap
      if (existingInTarget) {
        if (currentKey) {
          next[currentKey] = existingInTarget;
        } else {
          delete next[currentKey];
        }
      } else {
        if (currentKey) delete next[currentKey];
      }

      next[targetKey] = guestId;

      // Auto-place plus one adjacent if moving primary guest from unassigned
      if (!currentKey) {
        const guest = guests.find((g) => g.id === guestId);
        if (guest && !guest.isPlusOne) {
          const plusOneId = `${guestId}_plus1`;
          const plusOne = guests.find((g) => g.id === plusOneId);
          if (plusOne && !assignedIds.has(plusOneId)) {
            const [tbl] = targetKey.split("__");
            const tableObj = tables.find((t) => t.id === tbl);
            if (tableObj) {
              for (let i = 0; i < tableObj.seats; i++) {
                const key = `${tbl}__${i}`;
                if (!next[key]) { next[key] = plusOneId; break; }
              }
            }
          }
        }
      }
      return next;
    });
  };

  const removeFromSeat = (tableId, seatIdx) => {
    const key = `${tableId}__${seatIdx}`;
    setAssignments((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };

  const addTable = () => {
    const n = tables.length + 1;
    setTables((t) => [...t, { id: `t${Date.now()}`, name: `Table ${n}`, seats: 10, isHeadTable: false }]);
  };
  const removeTable = (tid) => {
    if (!confirm("Remove this table? Guests will return to unassigned.")) return;
    setTables((t) => t.filter((x) => x.id !== tid));
    setAssignments((a) => {
      const n = { ...a };
      Object.keys(n).filter((k) => k.startsWith(tid + "__")).forEach((k) => delete n[k]);
      return n;
    });
  };
  const updateTable = (tid, field, val) => setTables((t) => t.map((x) => x.id === tid ? { ...x, [field]: val } : x));

  if (loading) return <div className="loading">Loading seating...</div>;
  if (!event?.hasSeating) return (
    <div className="empty-state" style={{ padding: "4rem" }}>
      <div className="icon">🪑</div>
      <h3>Seating not enabled</h3>
      <p>Edit the event and check "This event has assigned seating."</p>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Seating</h1>
          <p>{event.name} · {unassigned.length} unassigned · {Object.keys(assignments).length} seated</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm" onClick={exportExcel}>⬇ Export Excel</button>
          <button className="btn btn-secondary btn-sm" onClick={addTable}>＋ Add Table</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Seating"}</button>
        </div>
      </div>

      <div style={{ marginBottom: "0.875rem", display: "flex", gap: "1.25rem", alignItems: "center", fontSize: "0.8125rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--gray-200)", border: "1.5px solid var(--gray-300)" }} />
          <span style={{ color: "var(--gray-500)" }}>Guest</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--gold-light)", border: "1.5px solid var(--gold)" }} />
          <span style={{ color: "var(--gray-500)" }}>Plus one</span>
        </span>
        <span style={{ color: "var(--gray-400)" }}>Drag guests between seats or back to unassigned list</span>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="seating-layout">
          {/* Unassigned list */}
          <div className="seating-sidebar">
            <div className="seating-sidebar-header">
              Unassigned <span style={{ fontWeight: 400, color: "var(--gray-400)" }}>({unassigned.length})</span>
            </div>
            {/* Make sidebar itself a drop target so guests can be dragged back */}
            <UnassignedDropZone>
              <div className="unassigned-list">
                {unassigned.length === 0 ? (
                  <div style={{ padding: "1.5rem 1rem", fontSize: "0.8125rem", color: "var(--gray-400)", textAlign: "center" }}>
                    All guests seated ✓
                  </div>
                ) : (
                  unassigned.map((g) => <GuestChip key={g.id} guest={g} />)
                )}
              </div>
            </UnassignedDropZone>
          </div>

          {/* Tables */}
          <div className="seating-canvas">
            {tables.map((table) => (
              <div key={table.id} className={`table-block${table.isHeadTable ? " head-table" : ""}`}>
                <div className="table-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                    <input
                      className="form-input"
                      value={table.name}
                      onChange={(e) => updateTable(table.id, "name", e.target.value)}
                      style={{ width: 140, padding: "0.1875rem 0.5rem", fontSize: "0.875rem", fontWeight: 700, border: "1px solid transparent", borderRadius: "var(--radius-sm)", background: "transparent" }}
                      onFocus={(e) => { e.target.style.border = "1px solid var(--navy)"; e.target.style.background = "white"; }}
                      onBlur={(e) => { e.target.style.border = "1px solid transparent"; e.target.style.background = "transparent"; }}
                    />
                    <label className="checkbox-label" style={{ fontSize: "0.75rem" }}>
                      <input type="checkbox" checked={table.isHeadTable} onChange={(e) => updateTable(table.id, "isHeadTable", e.target.checked)} />
                      Head table
                    </label>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--gray-400)" }}>
                      {Array.from({ length: table.seats }, (_, i) => assignments[`${table.id}__${i}`]).filter(Boolean).length}/{table.seats} seated
                    </span>
                    <label style={{ fontSize: "0.75rem", color: "var(--gray-500)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      Seats:
                      <input type="number" min={1} max={30} value={table.seats}
                        onChange={(e) => updateTable(table.id, "seats", parseInt(e.target.value, 10) || 1)}
                        style={{ width: 48, padding: "0.125rem 0.375rem", fontSize: "0.875rem", border: "1px solid var(--gray-200)", borderRadius: "var(--radius-sm)" }} />
                    </label>
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)", padding: "0.1875rem 0.5rem" }} onClick={() => removeTable(table.id)}>✕</button>
                  </div>
                </div>
                <div className="table-seats">
                  {Array.from({ length: table.seats }, (_, i) => (
                    <SeatSlot key={i} tableId={table.id} seatIndex={i}
                      occupant={getOccupant(table.id, i)}
                      allGuests={guests}
                      onRemove={removeFromSeat} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DragOverlay>
          {draggingGuest && (
            <div className={`guest-chip${draggingGuest.isPlusOne ? " plus-one" : ""}`} style={{ boxShadow: "var(--shadow-md)", cursor: "grabbing", opacity: 0.95 }}>
              <div>
                <div className="chip-name">{draggingGuest.displayName}</div>
                {draggingGuest.isPlusOne && draggingGuest.primaryGuestName && (
                  <div className="chip-meta">+1 of {draggingGuest.primaryGuestName}</div>
                )}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// Drop zone for unassigning guests by dragging back to sidebar
function UnassignedDropZone({ children }) {
  const { setNodeRef, isOver } = useDroppable({ id: "__unassigned__" });
  return (
    <div ref={setNodeRef} style={{ flex: 1, display: "flex", flexDirection: "column", background: isOver ? "var(--navy-xlight)" : "transparent", transition: "background 0.15s" }}>
      {children}
    </div>
  );
}
