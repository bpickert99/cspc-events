import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, getDocs, query, collection, where, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

// ─── Draggable guest chip ──────────────────────────────────────────────────
function GuestChip({ guest, isAssigned }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: guest.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className={`guest-chip${guest.isPlusOne ? " plus-one" : ""}`}>
      <div>
        <div className="chip-name">{guest.displayName}</div>
        {guest.dietary && <div className="chip-meta">🍽 {guest.dietary}</div>}
      </div>
      {guest.isPlusOne && <span title="Plus one" style={{ fontSize: "0.7rem" }}>＋1</span>}
    </div>
  );
}

// ─── Droppable seat slot ────────────────────────────────────────────────────
function SeatSlot({ tableId, seatIndex, occupant, onRemove }) {
  const { isOver, setNodeRef } = useDroppable({ id: `${tableId}__${seatIndex}` });
  return (
    <div ref={setNodeRef} className={`seat-slot${occupant ? ` occupied${occupant.isPlusOne ? " plus-one" : ""}` : ""}${isOver ? " drag-over" : ""}`}>
      <span className="seat-number">{seatIndex + 1}</span>
      {occupant ? (
        <>
          <div className="seat-guest">{occupant.displayName}</div>
          <span className="seat-remove" onClick={() => onRemove(tableId, seatIndex)}>✕</span>
        </>
      ) : (
        <span style={{ fontSize: "0.75rem" }}>Empty</span>
      )}
    </div>
  );
}

export default function SeatingManager() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);  // enriched guest list
  const [tables, setTables] = useState([]);   // [{ id, name, seats, isHeadTable }]
  const [assignments, setAssignments] = useState({}); // { "tableId__seatIdx": guestId }
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

      // Build enriched guest list including plus-ones as separate entries
      const enriched = [];
      rawGuests.forEach((g) => {
        if (g.rsvpStatus === "no") return; // exclude declined
        enriched.push({
          id: g.id,
          displayName: `${g.firstName} ${g.lastName}`,
          title: g.title,
          isPlusOne: false,
          primaryGuestId: null,
          dietary: g.rsvpData?.["Dietary restrictions"] || "",
        });
        if (g.plusOneEligible && (g.plusOneRsvpStatus === "yes" || (!g.plusOneRsvpStatus && g.rsvpStatus === "yes")) && g.plusOneName) {
          enriched.push({
            id: `${g.id}_plus1`,
            displayName: g.plusOneName,
            isPlusOne: true,
            primaryGuestId: g.id,
            dietary: g.rsvpData?.["Plus one dietary restrictions"] || "",
          });
        }
      });
      setGuests(enriched);

      // Load or create seating doc
      const seatSnap = await getDoc(doc(db, "seating", id));
      if (seatSnap.exists()) {
        setTables(seatSnap.data().tables || []);
        setAssignments(seatSnap.data().assignments || {});
      } else {
        // Default: 10 tables of 10
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

  // Assigned guest IDs
  const assignedIds = new Set(Object.values(assignments));
  const unassigned = guests.filter((g) => !assignedIds.has(g.id));

  const getOccupant = (tableId, seatIdx) => {
    const gid = assignments[`${tableId}__${seatIdx}`];
    return gid ? guests.find((g) => g.id === gid) : null;
  };

  const onDragStart = ({ active }) => {
    setDraggingGuest(guests.find((g) => g.id === active.id));
  };

  const onDragEnd = ({ active, over }) => {
    setDraggingGuest(null);
    if (!over) return;
    const guestId = active.id;
    const targetKey = over.id;
    if (!targetKey.includes("__")) return;

    const [targetTable, targetSeatStr] = targetKey.split("__");
    const targetIdx = parseInt(targetSeatStr, 10);
    const existingInTarget = assignments[targetKey];
    const currentKey = Object.entries(assignments).find(([, v]) => v === guestId)?.[0];

    setAssignments((prev) => {
      const next = { ...prev };
      // If target is occupied, swap
      if (existingInTarget && currentKey) {
        next[currentKey] = existingInTarget;
      } else if (currentKey) {
        delete next[currentKey];
      }
      next[targetKey] = guestId;

      // If guest has a plus one (or is a plus one), try to place them at the adjacent seat
      const guest = guests.find((g) => g.id === guestId);
      if (guest && !guest.isPlusOne) {
        const plusOneId = `${guestId}_plus1`;
        const plusOne = guests.find((g) => g.id === plusOneId);
        if (plusOne && !assignedIds.has(plusOneId)) {
          // Place plus-one in next available seat at same table
          const tableObj = tables.find((t) => t.id === targetTable);
          if (tableObj) {
            for (let i = 0; i < tableObj.seats; i++) {
              const key = `${targetTable}__${i}`;
              if (!next[key]) { next[key] = plusOneId; break; }
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

  // Table management
  const addTable = () => {
    const n = tables.length + 1;
    setTables((t) => [...t, { id: `t${Date.now()}`, name: `Table ${n}`, seats: 10, isHeadTable: false }]);
  };
  const removeTable = (tid) => {
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
      <h3>Seating not enabled for this event</h3>
      <p>Edit the event and check "This event has assigned seating" to enable the seating manager.</p>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Seating — {event.name}</h1>
          <p>Drag guests from the left panel into seats. Plus-ones move with their primary guest.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm" onClick={addTable}>＋ Add Table</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Seating"}</button>
        </div>
      </div>

      <div style={{ marginBottom: "0.75rem", display: "flex", gap: "1rem", alignItems: "center", fontSize: "0.8125rem", color: "var(--gray-600)" }}>
        <span>🟦 Assigned &nbsp; 🟡 Plus one &nbsp; 📋 Drag guests into seats</span>
        <span style={{ marginLeft: "auto" }}>{unassigned.length} unassigned · {Object.keys(assignments).length} seated</span>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="seating-layout">
          {/* Unassigned list */}
          <div className="seating-sidebar">
            <div className="seating-sidebar-header">Unassigned ({unassigned.length})</div>
            <div className="unassigned-list">
              {unassigned.length === 0 ? (
                <div style={{ padding: "1rem", fontSize: "0.8125rem", color: "var(--gray-400)", textAlign: "center" }}>All guests seated!</div>
              ) : (
                unassigned.map((g) => <GuestChip key={g.id} guest={g} />)
              )}
            </div>
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
                      style={{ width: 140, padding: "0.1875rem 0.5rem", fontSize: "0.875rem", fontWeight: 700 }}
                    />
                    <label className="checkbox-label" style={{ fontSize: "0.75rem" }}>
                      <input type="checkbox" checked={table.isHeadTable} onChange={(e) => updateTable(table.id, "isHeadTable", e.target.checked)} />
                      Head table
                    </label>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", color: "var(--gray-400)" }}>Seats:</label>
                    <input type="number" min={1} max={30}
                      value={table.seats}
                      onChange={(e) => updateTable(table.id, "seats", parseInt(e.target.value, 10) || 1)}
                      className="form-input"
                      style={{ width: 56, padding: "0.1875rem 0.375rem", fontSize: "0.875rem" }}
                    />
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => { if (confirm(`Remove ${table.name}?`)) removeTable(table.id); }}>✕</button>
                  </div>
                </div>
                <div className="table-seats">
                  {Array.from({ length: table.seats }, (_, i) => (
                    <SeatSlot key={i} tableId={table.id} seatIndex={i} occupant={getOccupant(table.id, i)} onRemove={removeFromSeat} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DragOverlay>
          {draggingGuest && (
            <div className={`guest-chip${draggingGuest.isPlusOne ? " plus-one" : ""}`} style={{ boxShadow: "var(--shadow-md)", cursor: "grabbing" }}>
              <div className="chip-name">{draggingGuest.displayName}</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
