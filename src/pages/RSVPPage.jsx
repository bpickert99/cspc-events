import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

function fmt24(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
}

// Generate ICS calendar file content
function generateICS(event, parts) {
  const getDate = (ts) => ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  const formatICSDate = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const eventDate = getDate(event.date);
  if (!eventDate) return null;

  // Use first part start time if available
  const firstPart = parts[0];
  let startDate = new Date(eventDate);
  let endDate = new Date(eventDate);

  if (firstPart?.startTime) {
    const [sh, sm] = firstPart.startTime.split(":").map(Number);
    startDate.setHours(sh, sm, 0);
  } else {
    startDate.setHours(18, 0, 0);
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart?.endTime) {
    const [eh, em] = lastPart.endTime.split(":").map(Number);
    endDate.setHours(eh, em, 0);
  } else {
    endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  }

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CSPC Events//EN
BEGIN:VEVENT
UID:${event.id}@cspc-events
DTSTART:${formatICSDate(startDate)}
DTEND:${formatICSDate(endDate)}
SUMMARY:${event.name}
LOCATION:${event.location || ""}
DESCRIPTION:Center for the Study of the Presidency and Congress
ORGANIZER:mailto:events@thepresidency.org
END:VEVENT
END:VCALENDAR`;
}

function generateGoogleCalendarUrl(event, parts) {
  const getDate = (ts) => ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  const eventDate = getDate(event.date);
  if (!eventDate) return null;
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const start = new Date(eventDate);
  const end = new Date(eventDate);
  const firstPart = parts[0];
  const lastPart = parts[parts.length - 1];
  if (firstPart?.startTime) { const [h, m] = firstPart.startTime.split(":").map(Number); start.setHours(h, m, 0); } else { start.setHours(18, 0, 0); }
  if (lastPart?.endTime) { const [h, m] = lastPart.endTime.split(":").map(Number); end.setHours(h, m, 0); } else { end.setTime(start.getTime() + 2 * 60 * 60 * 1000); }
  const params = new URLSearchParams({ action: "TEMPLATE", text: event.name, dates: `${fmt(start)}/${fmt(end)}`, location: event.location || "", details: "Center for the Study of the Presidency and Congress" });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function AddToCalendar({ event, invitedParts }) {
  const ics = generateICS(event, invitedParts);
  const googleUrl = generateGoogleCalendarUrl(event, invitedParts);

  const downloadICS = () => {
    if (!ics) return;
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.name.replace(/[^a-z0-9]/gi, "_")}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ marginTop: "1.5rem", padding: "1.25rem", background: "var(--navy-xlight)", border: "1px solid var(--navy-light)", borderRadius: "var(--radius)", textAlign: "center" }}>
      <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: "0.75rem", fontSize: "0.9375rem" }}>📅 Add to your calendar</div>
      <div style={{ display: "flex", gap: "0.625rem", justifyContent: "center", flexWrap: "wrap" }}>
        {googleUrl && (
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
            Google Calendar
          </a>
        )}
        {ics && (
          <button className="btn btn-secondary btn-sm" onClick={downloadICS}>
            Download .ics (Outlook / Apple)
          </button>
        )}
      </div>
    </div>
  );
}

export default function RSVPPage() {
  const { token } = useParams();
  const [state, setState] = useState("loading");
  const [event, setEvent] = useState(null);
  const [guest, setGuestData] = useState(null);
  const [guestRef, setGuestRef] = useState(null);
  const [editing, setEditing] = useState(false); // allow re-RSVP

  const [partAttendance, setPartAttendance] = useState({});
  const [plusOneAttending, setPlusOneAttending] = useState("");
  const [plusOneName, setPlusOneName] = useState("");
  const [customFields, setCustomFields] = useState({});

  const loadGuest = async () => {
    try {
      const q = query(collection(db, "guests"), where("rsvpToken", "==", token));
      const snap = await getDocs(q);
      if (snap.empty) { setState("notfound"); return; }
      const guestDoc = snap.docs[0];
      const g = { id: guestDoc.id, ...guestDoc.data() };
      setGuestData(g);
      setGuestRef(guestDoc.ref);

      const evSnap = await getDoc(doc(db, "events", g.eventId));
      if (!evSnap.exists()) { setState("error"); return; }
      const ev = { id: evSnap.id, ...evSnap.data() };
      setEvent(ev);

      // Pre-fill from previous response if editing
      const initParts = {};
      (g.invitedParts || []).forEach((pid) => {
        initParts[pid] = g.rsvpParts?.includes(pid) ? "yes" : (g.rsvpStatus === "no" ? "no" : "");
      });
      setPartAttendance(initParts);
      setPlusOneAttending(g.plusOneRsvpStatus === "yes" ? "yes" : g.plusOneRsvpStatus === "no" ? "no" : "");
      setPlusOneName(g.plusOneRsvpName || "");
      setCustomFields(g.rsvpData || {});

      if (g.rsvpStatus && g.rsvpStatus !== "pending" && !editing) {
        setState("submitted");
      } else {
        setState("form");
      }
    } catch (err) { console.error(err); setState("error"); }
  };

  useEffect(() => { loadGuest(); }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    const attendingParts = Object.entries(partAttendance).filter(([, v]) => v === "yes").map(([k]) => k);
    const anyYes = attendingParts.length > 0;
    // No more "partial" — attending = yes to any part, declined = no to all
    const rsvpStatus = anyYes ? "yes" : "no";
    const limit = guest.plusOneLimit ?? (guest.plusOneEligible ? 1 : 0);

    await updateDoc(guestRef, {
      rsvpStatus,
      rsvpParts: attendingParts,
      rsvpData: customFields,
      plusOneRsvpStatus: limit !== 0 && anyYes ? (plusOneAttending || "pending") : "no",
      plusOneRsvpName: plusOneAttending === "yes" ? plusOneName : "",
      rsvpSubmittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setGuestData((g) => ({ ...g, rsvpStatus, rsvpParts: attendingParts, plusOneRsvpStatus: limit !== 0 && anyYes ? (plusOneAttending || "pending") : "no", plusOneRsvpName: plusOneAttending === "yes" ? plusOneName : "" }));
    setEditing(false);
    setState("submitted");
  };

  const setCustom = (label, val) => setCustomFields((s) => ({ ...s, [label]: val }));

  const logoPath = "../cspc-logo.png";

  if (state === "loading") return (
    <div className="rsvp-page"><div className="rsvp-header"><img src={logoPath} alt="CSPC" /></div>
      <div className="rsvp-body"><div className="loading">Loading your invitation...</div></div></div>
  );

  if (state === "notfound") return (
    <div className="rsvp-page"><div className="rsvp-header"><img src={logoPath} alt="CSPC" /></div>
      <div className="rsvp-body"><div className="rsvp-event-banner"><h1>Invitation not found</h1><p style={{ color: "var(--gray-500)", marginTop: "0.5rem" }}>This link may be invalid or expired. Contact <a href="mailto:events@thepresidency.org">events@thepresidency.org</a>.</p></div></div></div>
  );

  if (state === "error") return (
    <div className="rsvp-page"><div className="rsvp-header"><img src={logoPath} alt="CSPC" /></div>
      <div className="rsvp-body"><div className="error-msg">Something went wrong. Please try again.</div></div></div>
  );

  if (state === "submitted" && !editing) {
    const attending = guest?.rsvpStatus === "yes";
    const dateStr = event?.date
      ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
      : "";
    const invitedParts = (event?.parts || []).filter((p) => (guest?.invitedParts || []).includes(p.id));

    return (
      <div className="rsvp-page">
        <div className="rsvp-header"><img src={logoPath} alt="CSPC" /></div>
        <div className="rsvp-body">
          <div className="rsvp-thanks">
            <div className="check">{attending ? "✅" : "📋"}</div>
            <h2>{attending ? "We'll see you there!" : "Thank you for letting us know."}</h2>
            <p style={{ color: "var(--gray-500)", fontSize: "0.9375rem" }}>
              {attending
                ? `Your RSVP for ${event?.name} has been received.${dateStr ? ` We look forward to seeing you on ${dateStr}.` : ""}`
                : `We're sorry you won't be able to join us${event?.name ? ` for ${event.name}` : ""}.`}
            </p>

            {attending && event && <AddToCalendar event={event} invitedParts={invitedParts} />}

            <div style={{ marginTop: "1.5rem" }}>
              <button className="btn btn-secondary" onClick={() => { setEditing(true); setState("form"); }}>
                ✏️ Update my RSVP
              </button>
            </div>

            <p style={{ marginTop: "1.25rem", color: "var(--gray-400)", fontSize: "0.8125rem" }}>
              Need help? Contact <a href="mailto:events@thepresidency.org">events@thepresidency.org</a>
            </p>
          </div>
        </div>
        <div className="rsvp-footer">
          <img src={logoPath} alt="CSPC" style={{ height: 26, opacity: 0.35, display: "block", margin: "0 auto 0.5rem" }} />
          <div>Center for the Study of the Presidency and Congress · Washington, D.C.</div>
          <div>601 13th Street NW, Suite 940N, Washington, DC 20005</div>
        </div>
      </div>
    );
  }

  if (!event || !guest) return null;

  const dateStr = event.date
    ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : null;

  const invitedParts = (event.parts || []).filter((p) => (guest.invitedParts || []).includes(p.id));
  const isSinglePart = invitedParts.length === 1;
  const anyAttending = Object.values(partAttendance).some((v) => v === "yes");
  const limit = guest.plusOneLimit ?? (guest.plusOneEligible ? 1 : 0);

  const relevantFields = (event.customFields || []).filter((f) => {
    if (!f.forParts || f.forParts.length === 0) return true;
    return f.forParts.some((pid) => (guest.invitedParts || []).includes(pid));
  });

  return (
    <div className="rsvp-page">
      <div className="rsvp-header">
        <img src={logoPath} alt="Center for the Study of the Presidency and Congress" />
      </div>

      <div className="rsvp-body">
        {editing && (
          <div style={{ background: "var(--amber-light)", border: "1px solid var(--amber)", borderRadius: "var(--radius)", padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.875rem", color: "#92400E" }}>
            ✏️ Updating your RSVP. Your previous response will be replaced when you submit.
          </div>
        )}

        <div className="rsvp-event-banner">
          <h1>{event.name}</h1>
          <div className="rsvp-event-meta">
            {dateStr && <span>📅 {dateStr}</span>}
            {event.location && <span>📍 {event.location.split(",")[0]}</span>}
            {invitedParts.map((p) => (
              <span key={p.id}>{p.name}{p.startTime ? `: ${fmt24(p.startTime)}${p.endTime ? ` – ${fmt24(p.endTime)}` : ""}` : ""}</span>
            ))}
          </div>
        </div>

        <div className="rsvp-form-card">
          <h2>Dear {guest.title ? `${guest.title} ` : ""}{guest.firstName} {guest.lastName},</h2>
          <p style={{ fontSize: "0.9375rem", color: "var(--gray-500)", marginBottom: "1.375rem" }}>
            Please confirm your attendance{invitedParts.length > 1 ? " for each part of the event" : ""} below.
          </p>

          <form onSubmit={submit}>
            {isSinglePart ? (
              <div className="rsvp-part-block">
                <h3>Will you attend?</h3>
                <div className="rsvp-radio-group">
                  {["yes", "no"].map((opt) => (
                    <label key={opt} className="rsvp-radio">
                      <input type="radio" name={`part_${invitedParts[0].id}`} value={opt} required
                        checked={partAttendance[invitedParts[0].id] === opt}
                        onChange={() => setPartAttendance({ [invitedParts[0].id]: opt })} />
                      {opt === "yes" ? "Yes, I will attend" : "No, I cannot attend"}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              invitedParts.map((part) => (
                <div key={part.id} className="rsvp-part-block">
                  <h3>{part.name}{part.startTime && <span style={{ fontWeight: 400, fontSize: "0.875rem", marginLeft: "0.5rem" }}>{fmt24(part.startTime)}{part.endTime ? ` – ${fmt24(part.endTime)}` : ""}</span>}</h3>
                  <div className="rsvp-radio-group">
                    {["yes", "no"].map((opt) => (
                      <label key={opt} className="rsvp-radio">
                        <input type="radio" name={`part_${part.id}`} value={opt} required
                          checked={partAttendance[part.id] === opt}
                          onChange={() => setPartAttendance((s) => ({ ...s, [part.id]: opt }))} />
                        {opt === "yes" ? "Yes" : "No"}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}

            {limit !== 0 && anyAttending && (
              <div style={{ marginBottom: "1rem" }}>
                <div className="rsvp-part-block" style={{ background: "var(--gold-light)", borderColor: "rgba(201,168,76,.3)" }}>
                  <h3 style={{ color: "var(--gold-dark)" }}>Plus One{limit === -1 ? "" : limit > 1 ? ` (up to ${limit})` : ""}</h3>
                  <div className="rsvp-radio-group" style={{ marginBottom: "0.75rem" }}>
                    {["yes", "no"].map((opt) => (
                      <label key={opt} className="rsvp-radio">
                        <input type="radio" name="plus_one" value={opt} required checked={plusOneAttending === opt} onChange={() => setPlusOneAttending(opt)} />
                        {opt === "yes" ? "Yes, I'll bring a guest" : "No, just me"}
                      </label>
                    ))}
                  </div>
                  {plusOneAttending === "yes" && (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--gray-600)", display: "block", marginBottom: "0.375rem" }}>Guest's full name <span style={{ color: "var(--red)" }}>*</span></label>
                      <input className="form-input" value={plusOneName} onChange={(e) => setPlusOneName(e.target.value)} placeholder="Full name of your guest" required />
                    </div>
                  )}
                </div>
              </div>
            )}

            {anyAttending && relevantFields.length > 0 && (
              <div>
                <div className="divider" />
                {relevantFields.map((field) => (
                  <div key={field.id} className="form-group">
                    <label style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--gray-600)", display: "block", marginBottom: "0.375rem" }}>
                      {field.label}{field.required && <span style={{ color: "var(--red)", marginLeft: 2 }}>*</span>}
                    </label>
                    {field.type === "boolean" ? (
                      <div className="rsvp-radio-group">
                        {["Yes", "No"].map((opt) => (
                          <label key={opt} className="rsvp-radio">
                            <input type="radio" name={field.id} value={opt} required={field.required} checked={customFields[field.label] === opt} onChange={() => setCustom(field.label, opt)} />{opt}
                          </label>
                        ))}
                      </div>
                    ) : field.type === "select" ? (
                      <select className="form-select" required={field.required} value={customFields[field.label] || ""} onChange={(e) => setCustom(field.label, e.target.value)}>
                        <option value="">Select...</option>
                        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className="form-input" type="text" required={field.required} value={customFields[field.label] || ""} onChange={(e) => setCustom(field.label, e.target.value)} placeholder={`Your ${field.label.toLowerCase()}`} />
                    )}
                  </div>
                ))}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg" style={{ width: "100%", marginTop: "1.25rem" }}>
              {editing ? "Update RSVP" : "Submit RSVP"}
            </button>
            {editing && <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: "0.5rem" }} onClick={() => { setEditing(false); setState("submitted"); }}>Cancel</button>}
          </form>
        </div>
      </div>

      <div className="rsvp-footer">
        <img src={logoPath} alt="CSPC" style={{ height: 26, opacity: 0.35, display: "block", margin: "0 auto 0.5rem" }} />
        <div>Center for the Study of the Presidency and Congress · Washington, D.C.</div>
        <div>601 13th Street NW, Suite 940N, Washington, DC 20005</div>
        <div>Questions? <a href="mailto:events@thepresidency.org">events@thepresidency.org</a></div>
      </div>
    </div>
  );
}
