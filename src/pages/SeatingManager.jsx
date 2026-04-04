import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, getDocs, query, collection, where, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import * as XLSX from "xlsx";

// ─── Draggable guest chip (used in both unassigned list AND seat slots) ────────
function DraggableChip({ guest }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: guest.id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className={`guest-chip${guest.isPlusOne ? " plus-one" : ""}`}>
      <div>
        <div className="chip-name">{guest.displayName}</div>
        {guest.isPlusOne && guest.primaryName && (
          <div className="chip-plus-of">＋1 of {guest.primaryName}</div>
        )}
        {!guest.isPlusOne && guest.dietary && (
          <div className="chip-meta">🍽 {guest.dietary}</div>
        )}
      </div>
      {guest.isPlusOne && <span style={{ fontSize: "0.65rem", color: "var(--gold)", fontWeight: 700, flexShrink: 0 }}>＋1</span>}
    </div>
  );
}

// ─── Droppable seat slot ────────────────────────────────────────────────────────
function SeatSlot({ tableId, seatIndex, occupant, onRemove }) {
  const slotId = `${tableId}__${seatIndex}`;
  const { isOver, setNodeRef } = useDroppable({ id: slotId });

  return (
    <div
      ref={setNodeRef}
      className={`seat-slot${occupant ? ` occupied${occupant.isPlusOne ? " plus-one" : ""}` : ""}${isOver ? " drag-over" : ""}`}
    >
      <span className="seat-number">{seatIndex + 1}</span>
      {occupant ? (
        <DraggableChip guest={occupant} />
      ) : (
        <span style={{ fontSize: "0.75rem", color: "var(--gray-300)" }}>Empty</span>
      )}
      {occupant && (
        <span className="seat-remove" onClick={() => onRemove(tableId, seatIndex)} title="Unassign">✕</span>
      )}
    </div>
  );
}

// ─── Droppable unassigned zone ──────────────────────────────────────────────────
function UnassignedDropZone({ children }) {
  const { isOver, setNodeRef } = useDroppable({ id: "unassigned-pool" });
  return (
    <div ref={setNodeRef} className="unassigned-list"
      style={{ background: isOver ? "var(--navy-light)" : "", transition: "background 0.15s", minHeight: 60 }}>
      {children}
    </div>
  );
}

export default function SeatingManager() {
  const { id } = useParams();
  const [event, setEvent]   = useState(null);
  const [allGuests, setAllGuests] = useState([]); // full enriched list
  const [guests, setGuests] = useState([]);        // filtered by selected part
  const [selectedPart, setSelectedPart] = useState("all");
  const [tables, setTables] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loading, setLoading]  = useState(true);
  const [saving, setSaving]    = useState(false);
  const [draggingGuest, setDraggingGuest] = useState(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    (async () => {
      const evSnap = await getDoc(doc(db, "events", id));
      if (!evSnap.exists()) return;
      setEvent({ id: evSnap.id, ...evSnap.data() });

      const guestSnap = await getDocs(query(collection(db, "guests"), where("eventId", "==", id)));
      const rawGuests = guestSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Build enriched list — ONLY guests who RSVPed yes
      const enriched = [];
      rawGuests.forEach((g) => {
        if (g.rsvpStatus !== "yes") return; // only confirmed attendees
        enriched.push({
          id: g.id,
          displayName: `${g.title ? g.title + " " : ""}${g.firstName} ${g.lastName}`.trim(),
          isPlusOne: false,
          primaryGuestId: null,
          primaryName: null,
          dietary: g.rsvpData?.["Dietary restrictions"] || "",
          invitedParts: g.rsvpParts?.length ? g.rsvpParts : (g.invitedParts || []),
        });
        const plusName = g.plusOneRsvpName || (g.staffPlusOneNames?.filter(Boolean)[0] || "");
        if (g.plusOneRsvpStatus === "yes" || (plusName && g.plusOneRsvpStatus !== "no")) {
          enriched.push({
            id: `${g.id}_plus0`,
            displayName: plusName || `${g.firstName} ${g.lastName}'s Guest`,
            isPlusOne: true,
            primaryGuestId: g.id,
            primaryName: `${g.firstName} ${g.lastName}`,
            dietary: g.rsvpData?.["Plus one dietary restrictions"] || "",
            invitedParts: g.rsvpParts?.length ? g.rsvpParts : (g.invitedParts || []),
          });
        }
      });
      setAllGuests(enriched);
      setGuests(enriched);

      // Load or create seating doc
      const seatSnap = await getDoc(doc(db, "seating", id));
      if (seatSnap.exists()) {
        setTables(seatSnap.data().tables || []);
        setAssignments(seatSnap.data().assignments || {});
      } else {
        // Default: 10 tables of 10
        setTables(Array.from({ length: 10 }, (_, i) => ({
          id: `t${i + 1}`,
          name: i === 0 ? "Head Table" : `Table ${i}`,
          seats: 10,
          isHeadTable: i === 0,
        })));
      }
      setLoading(false);
    })();
  }, [id]);

  const save = async () => {
    setSaving(true);
    await setDoc(doc(db, "seating", id), { tables, assignments, updatedAt: serverTimestamp() });
    setSaving(false);
  };

  // Filter guests by selected part
  useEffect(() => {
    if (selectedPart === "all") {
      setGuests(allGuests);
    } else {
      setGuests(allGuests.filter((g) => (g.invitedParts || []).includes(selectedPart)));
    }
  }, [selectedPart, allGuests]);

  const assignedIds = new Set(Object.values(assignments));
  const unassigned  = guests.filter((g) => !assignedIds.has(g.id));

  const getOccupant = (tableId, seatIdx) => {
    const gid = assignments[`${tableId}__${seatIdx}`];
    return gid ? guests.find((g) => g.id === gid) : null;
  };

  // ─── Drag handlers ──────────────────────────────────────────────────────────
  const onDragStart = ({ active }) => {
    setDraggingGuest(guests.find((g) => g.id === active.id) || null);
  };

  const onDragEnd = ({ active, over }) => {
    setDraggingGuest(null);
    if (!over) return;
    const guestId  = active.id;
    const targetId = over.id;

    // Drop back to unassigned pool
    if (targetId === "unassigned-pool") {
      setAssignments((prev) => {
        const next = { ...prev };
        const curKey = Object.entries(next).find(([, v]) => v === guestId)?.[0];
        if (curKey) delete next[curKey];
        return next;
      });
      return;
    }

    if (!targetId.includes("__")) return;
    const [targetTable, targetSeatStr] = targetId.split("__");
    const targetIdx = parseInt(targetSeatStr, 10);
    const existingInTarget = assignments[targetId];
    const currentKey = Object.entries(assignments).find(([, v]) => v === guestId)?.[0];

    setAssignments((prev) => {
      const next = { ...prev };
      // Swap if target occupied
      if (existingInTarget && currentKey) {
        next[currentKey] = existingInTarget;
      } else if (currentKey) {
        delete next[currentKey];
      }
      next[targetId] = guestId;

      // Auto-place plus one in next available seat at same table (if from unassigned)
      if (!currentKey) {
        const guest = guests.find((g) => g.id === guestId);
        if (guest && !guest.isPlusOne) {
          const plusId = `${guestId}_plus0`;
          const plusGuest = guests.find((g) => g.id === plusId);
          if (plusGuest && !assignedIds.has(plusId)) {
            const tbl = tables.find((t) => t.id === targetTable);
            if (tbl) {
              for (let i = 0; i < tbl.seats; i++) {
                const k = `${targetTable}__${i}`;
                if (!next[k]) { next[k] = plusId; break; }
              }
            }
          }
        }
      }
      return next;
    });
  };

  // ─── Table management ───────────────────────────────────────────────────────
  const addTable = () => setTables((t) => [...t, { id: `t${Date.now()}`, name: `Table ${t.length}`, seats: 10, isHeadTable: false }]);
  const removeTable = (tid) => {
    setTables((t) => t.filter((x) => x.id !== tid));
    setAssignments((a) => {
      const n = { ...a };
      Object.keys(n).filter((k) => k.startsWith(tid + "__")).forEach((k) => delete n[k]);
      return n;
    });
  };
  const updateTable = (tid, field, val) => setTables((t) => t.map((x) => x.id === tid ? { ...x, [field]: val } : x));

  // ─── Excel export ────────────────────────────────────────────────────────────
  const exportExcel = () => {
    const rows = [["Table", "Seat #", "Name", "Plus One of", "Dietary Restrictions", "RSVP Status"]];
    tables.forEach((table) => {
      for (let i = 0; i < table.seats; i++) {
        const occupant = getOccupant(table.id, i);
        if (occupant) {
          rows.push([
            table.name,
            i + 1,
            occupant.displayName,
            occupant.isPlusOne ? occupant.primaryName : "",
            occupant.dietary || "",
            occupant.isPlusOne ? "Plus One" : "Attending",
          ]);
        } else {
          rows.push([table.name, i + 1, "", "", "", ""]);
        }
      }
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 30 }, { wch: 25 }, { wch: 30 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Seating");
    XLSX.writeFile(wb, `${event?.name || "seating"}_seating.xlsx`);
  };

  if (loading) return <div className="loading">Loading seating...</div>;

  if (!event?.hasSeating) return (
    <div className="empty-state" style={{ padding: "4rem" }}>
      <div className="icon">🪑</div>
      <h3>Seating not enabled for this event</h3>
      <p style={{ marginTop: "0.5rem" }}>Edit the event and check "This event has assigned seating" to enable the seating manager.</p>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Seating — {event.name}</h1>
          <p>Only confirmed (RSVPed) guests appear here. Drag between seats or back to unassigned.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm" onClick={exportExcel}>⬇ Export Excel</button>
          <button className="btn btn-secondary btn-sm" onClick={addTable}>＋ Add Table</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Seating"}</button>
        </div>
      </div>

      <div style={{ marginBottom: "0.75rem", display: "flex", gap: "1.25rem", flexWrap: "wrap", fontSize: "0.8125rem", color: "var(--gray-500)", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: "var(--navy)", display: "inline-block" }} /> Guest
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: "var(--gold)", display: "inline-block" }} /> Plus one
        </span>
        {(event.parts || []).length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontWeight: 600, color: "var(--gray-600)" }}>Seating for:</span>
            <div style={{ display: "flex", gap: "0.375rem" }}>
              <button className={`btn btn-sm ${selectedPart === "all" ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedPart("all")}>All parts</button>
              {event.parts.map((p) => (
                <button key={p.id} className={`btn btn-sm ${selectedPart === p.id ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedPart(p.id)}>{p.name}</button>
              ))}
            </div>
          </div>
        )}
        <span style={{ marginLeft: "auto" }}>
          {allGuests.length} confirmed · {unassigned.length} unassigned · {Object.keys(assignments).length} seated
          {allGuests.length === 0 && <span style={{ color: "var(--amber)", marginLeft: "0.5rem" }}>— No confirmed RSVPs yet</span>}
        </span>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="seating-layout">
          {/* Unassigned sidebar */}
          <div className="seating-sidebar">
            <div className="seating-sidebar-header">Unassigned ({unassigned.length})</div>
            <UnassignedDropZone>
              {unassigned.length === 0 ? (
                <div style={{ padding: "1rem", fontSize: "0.8125rem", color: "var(--gray-400)", textAlign: "center" }}>All guests seated ✓</div>
              ) : (
                unassigned.map((g) => <DraggableChip key={g.id} guest={g} />)
              )}
            </UnassignedDropZone>
          </div>

          {/* Tables */}
          <div className="seating-canvas">
            {tables.map((table) => (
              <div key={table.id} className={`table-block${table.isHeadTable ? " head-table" : ""}`}>
                <div className="table-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                    <input className="form-input" value={table.name}
                      onChange={(e) => updateTable(table.id, "name", e.target.value)}
                      style={{ width: 150, padding: "0.25rem 0.5rem", fontSize: "0.875rem", fontWeight: 700, border: "1.5px solid transparent", background: "transparent" }}
                      onFocus={(e) => { e.target.style.border = "1.5px solid var(--navy)"; e.target.style.background = "white"; }}
                      onBlur={(e) => { e.target.style.border = "1.5px solid transparent"; e.target.style.background = "transparent"; }}
                    />
                    <label className="checkbox-label" style={{ fontSize: "0.75rem" }}>
                      <input type="checkbox" checked={table.isHeadTable} onChange={(e) => updateTable(table.id, "isHeadTable", e.target.checked)} />
                      Head table
                    </label>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                    <label style={{ fontSize: "0.75rem", color: "var(--gray-400)", fontWeight: 600 }}>Seats:</label>
                    <input type="number" min={1} max={40} value={table.seats}
                      onChange={(e) => updateTable(table.id, "seats", parseInt(e.target.value, 10) || 1)}
                      className="form-input"
                      style={{ width: 60, padding: "0.25rem 0.5rem", fontSize: "0.875rem", textAlign: "center" }}
                    />
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }}
                      onClick={() => { if (confirm(`Remove ${table.name}?`)) removeTable(table.id); }}>✕</button>
                  </div>
                </div>
                <div className="table-seats">
                  {Array.from({ length: table.seats }, (_, i) => (
                    <SeatSlot key={i} tableId={table.id} seatIndex={i}
                      occupant={getOccupant(table.id, i)}
                      onRemove={(tid, si) => {
                        const key = `${tid}__${si}`;
                        setAssignments((prev) => { const n = { ...prev }; delete n[key]; return n; });
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DragOverlay>
          {draggingGuest && (
            <div className={`guest-chip${draggingGuest.isPlusOne ? " plus-one" : ""}`}
              style={{ boxShadow: "var(--shadow-lg)", cursor: "grabbing", opacity: 0.95 }}>
              <div>
                <div className="chip-name">{draggingGuest.displayName}</div>
                {draggingGuest.isPlusOne && draggingGuest.primaryName && (
                  <div className="chip-plus-of">＋1 of {draggingGuest.primaryName}</div>
                )}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
