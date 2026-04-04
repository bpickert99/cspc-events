import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, getDocs, query, collection, where, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage, TEST_MODE, EMAILJS_CONFIG } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import emailjs from "@emailjs/browser";

// ─── Open tracking pixel URL ──────────────────────────────────────────────────
// Once Cloudflare Worker is set up, replace this with your worker URL:
// e.g. https://cspc-tracker.YOUR_SUBDOMAIN.workers.dev/pixel/{{guestId}}
const TRACKING_PIXEL_URL = null; // Set to your Cloudflare Worker URL when ready

const MERGE_FIELDS = [
  { token: "{{firstName}}", label: "First Name" },
  { token: "{{lastName}}", label: "Last Name" },
  { token: "{{fullName}}", label: "Full Name" },
  { token: "{{staffPOC}}", label: "Staff POC" },
  { token: "{{eventName}}", label: "Event Name" },
  { token: "{{eventDate}}", label: "Event Date" },
  { token: "{{eventLocation}}", label: "Venue" },
  { token: "{{rsvpButton}}", label: "RSVP Button", highlight: true },
  { token: "{{rsvpLink}}", label: "RSVP Link (plain)" },
];

function resolveMerge(text, guest, event, baseUrl, buttonText) {
  const dateStr = event.date
    ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : "TBD";
  const rsvpLink = `${baseUrl}#/rsvp/${guest.rsvpToken}`;
  const btnLabel = buttonText || "RSVP Now";
  // VML fallback ensures the button renders in Outlook which ignores CSS backgrounds
  const rsvpButton = `<div style="text-align:center;margin:12px 0 4px;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${rsvpLink}" style="height:44px;v-text-anchor:middle;width:180px;" arcsize="18%" strokecolor="#0F1A45" fillcolor="#1B2B6B">
<w:anchorlock/>
<center style="color:#FFFFFF;font-family:sans-serif;font-size:15px;font-weight:700;">${btnLabel}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${rsvpLink}" style="display:inline-block;background:#1B2B6B;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.01em;mso-hide:all;">${btnLabel}</a>
<!--<![endif]-->
  </div>`;
  return text
    .replace(/{{firstName}}/g, guest.firstName)
    .replace(/{{lastName}}/g, guest.lastName)
    .replace(/{{fullName}}/g, `${guest.title ? guest.title + " " : ""}${guest.firstName} ${guest.lastName}`.trim())
    .replace(/{{staffPOC}}/g, guest.staffPoc || "")
    .replace(/{{eventName}}/g, event.name)
    .replace(/{{eventDate}}/g, dateStr)
    .replace(/{{eventLocation}}/g, event.location || "")
    .replace(/{{rsvpButton}}/g, rsvpButton)
    .replace(/{{rsvpLink}}/g, rsvpLink);
}

// Absolute logo URL — works in all email clients regardless of where the email is opened
const LOGO_URL = "https://bpickert99.github.io/cspc-events/cspc-logo.png";

function buildEmailHtml(bodyText, guest, event, attachments, logoUrl, baseUrl, buttonText) {
  const resolved = resolveMerge(bodyText, guest, event, baseUrl, buttonText);
  const pixelHtml = TRACKING_PIXEL_URL
    ? `<img src="${TRACKING_PIXEL_URL.replace("{{guestId}}", guest.id)}" width="1" height="1" style="display:none;" alt="" />`
    : "";
  const attHtml = attachments.length
    ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid #E4E8F0;font-size:13px;color:#6B7A99;">
        <strong>Attachments:</strong> ${attachments.map((a) => `<a href="${a.url}" style="color:#1B2B6B;">${a.name}</a>`).join(" &nbsp;|&nbsp; ")}
       </div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F6F8FC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
${pixelHtml}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FC;padding:32px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(15,26,69,.10);">
  <tr><td style="background:linear-gradient(135deg,#080F2E 0%,#1B2B6B 100%);padding:22px 32px;text-align:center;">
    <img src="${logoUrl}" alt="CSPC" style="height:38px;filter:brightness(0) invert(1);" />
  </td></tr>
  <tr><td style="padding:28px 36px;color:#1A202C;font-size:15px;line-height:1.75;">
    <div style="white-space:pre-wrap;">${resolved}</div>
    ${attHtml}
  </td></tr>
  <tr><td style="background:#F6F8FC;padding:14px 36px;text-align:center;font-size:12px;color:#94A0B8;border-top:1px solid #E4E8F0;">
    Center for the Study of the Presidency and Congress &nbsp;·&nbsp; Washington, D.C.<br>
    601 13th Street NW, Suite 940N, Washington, DC 20005
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const DEFAULT_BODY = (ev) =>
  `Dear {{fullName}},\n\nWe are pleased to invite you to ${ev.name}${ev.date ? " on {{eventDate}}" : ""}${ev.location ? " at {{eventLocation}}" : ""}.\n\nPlease RSVP using the button below.\n\n{{rsvpButton}}\n\nWarm regards,\n{{staffPOC}}`;

export default function InvitationComposer() {
  const { id } = useParams();
  const { user } = useAuth();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [template, setTemplate] = useState({ subject: "", body: "", fromName: "CSPC Events", fromStaffPoc: false, buttonText: "RSVP Now", attachments: [] });
  const [previewGuest, setPreviewGuest] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendingPreview, setSendingPreview] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [selectedGuests, setSelectedGuests] = useState("unsent");
  const [filterTag, setFilterTag] = useState("all");
  const [filterPart, setFilterPart] = useState("all");
  const [customIds, setCustomIds] = useState(new Set());
  const [tab, setTab] = useState("compose");

  const baseUrl = window.location.href.split("#")[0];

  useEffect(() => {
    getDoc(doc(db, "events", id)).then((s) => {
      if (s.exists()) {
        const ev = { id: s.id, ...s.data() };
        setEvent(ev);
        setTemplate((t) => ({ ...t, subject: t.subject || `You're invited: ${ev.name}`, body: t.body || DEFAULT_BODY(ev) }));
      }
    });
    getDoc(doc(db, "emailTemplates", id)).then((s) => { if (s.exists()) setTemplate((prev) => ({ ...prev, ...s.data() })); });
    getDocs(query(collection(db, "guests"), where("eventId", "==", id))).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setGuests(list);
      if (list.length > 0) setPreviewGuest(list[0]);
    });
  }, [id]);

  const set = (field) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setTemplate((t) => ({ ...t, [field]: val }));
  };

  const saveTemplate = async () => {
    await setDoc(doc(db, "emailTemplates", id), { ...template, updatedAt: serverTimestamp() });
  };

  // Fixed upload using uploadBytesResumable with progress tracking
  const uploadAttachment = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("File must be under 10MB."); return; }
    setUploadProgress(0);
    try {
      const storageRef = ref(storage, `attachments/${id}/${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      await new Promise((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
          reject,
          resolve
        );
      });
      const url = await getDownloadURL(storageRef);
      setTemplate((t) => ({ ...t, attachments: [...(t.attachments || []), { name: file.name, url, size: file.size }] }));
    } catch (err) {
      alert("Upload failed: " + err.message + "\n\nIf this is your first upload, you may need to configure Firebase Storage CORS. See README for instructions.");
    } finally {
      setUploadProgress(null);
      e.target.value = "";
    }
  };

  const removeAttachment = (name) => setTemplate((t) => ({ ...t, attachments: t.attachments.filter((a) => a.name !== name) }));

  const eventTags = event?.tags || [];
  const eventParts = event?.parts || [];
  const resolveFromName = (guest) => template.fromStaffPoc && guest.staffPoc ? guest.staffPoc : (template.fromName || "CSPC Events");

  const getTargetGuests = () => {
    let base;
    if (selectedGuests === "unsent") base = guests.filter((g) => !g.emailSent);
    else if (selectedGuests === "all") base = guests;
    else if (selectedGuests === "attending") base = guests.filter((g) => g.rsvpStatus === "yes");
    else if (selectedGuests === "pending") base = guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending");
    else base = guests.filter((g) => customIds.has(g.id));
    if (filterTag !== "all") base = base.filter((g) => (g.tags || []).includes(filterTag));
    if (filterPart !== "all") base = base.filter((g) => (g.invitedParts || []).includes(filterPart));
    return base;
  };

  const insertAtCursor = (token) => {
    const textarea = document.getElementById("email-body-textarea");
    if (!textarea) { setTemplate((t) => ({ ...t, body: t.body + token })); return; }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setTemplate((t) => ({ ...t, body: t.body.slice(0, start) + token + t.body.slice(end) }));
    setTimeout(() => { textarea.focus(); textarea.selectionStart = textarea.selectionEnd = start + token.length; }, 0);
  };

  const sendPreview = async () => {
    if (!previewGuest) return alert("No guest selected.");
    setSendingPreview(true); setPreviewResult(null);
    const html = buildEmailHtml(template.body, previewGuest, event, template.attachments || [], LOGO_URL, baseUrl, template.buttonText);
    const subject = `[PREVIEW] ${resolveMerge(template.subject, previewGuest, event, baseUrl, template.buttonText)}`;
    const fromName = resolveFromName(previewGuest);
    if (TEST_MODE) {
      console.log(`[PREVIEW]\nFrom: ${fromName}\nTo: ${user.email}\nSubject: ${subject}`);
      await new Promise((r) => setTimeout(r, 600));
      setPreviewResult({ ok: true, email: user.email });
    } else {
      await emailjs.send(
        EMAILJS_CONFIG.serviceId,
        EMAILJS_CONFIG.templateId,
        { to_email: user.email, subject, message: html, from_name: fromName },
        EMAILJS_CONFIG.publicKey
      );
      setPreviewResult({ ok: true, email: user.email });
    }
    setSendingPreview(false);
  };

  const sendAll = async () => {
    const targets = getTargetGuests();
    if (!targets.length) return alert("No guests to send to.");
    if (!confirm(`Send to ${targets.length} guest(s)?`)) return;
    setSending(true); setSendResult(null);
    await saveTemplate();
    const logoUrl = LOGO_URL;
    let sent = 0, failed = 0;
    for (const guest of targets) {
      try {
        const fromName = resolveFromName(guest);
        const html = buildEmailHtml(template.body, guest, event, template.attachments || [], logoUrl, baseUrl, template.buttonText);
        const subject = resolveMerge(template.subject, guest, event, baseUrl, template.buttonText);
        if (TEST_MODE) {
          console.log(`[TEST]\nFrom: ${fromName}\nTo: ${guest.email}\nSubject: ${subject}`);
          await new Promise((r) => setTimeout(r, 80));
        } else {
          await emailjs.send(
            EMAILJS_CONFIG.serviceId,
            EMAILJS_CONFIG.templateId,
            { to_email: guest.email, subject, message: html, from_name: fromName },
            EMAILJS_CONFIG.publicKey
          );
        }
        await updateDoc(doc(db, "guests", guest.id), { emailSent: true, emailSentAt: serverTimestamp() });
        sent++;
      } catch (err) { console.error("Failed:", guest.email, err); failed++; }
    }
    setSendResult({ sent, failed }); setSending(false);
  };

  if (!event) return <div className="loading">Loading...</div>;
  const targets = getTargetGuests();
  const previewHtml = previewGuest ? buildEmailHtml(template.body, previewGuest, event, template.attachments || [], LOGO_URL, baseUrl, template.buttonText) : "";
  const previewFromName = previewGuest ? resolveFromName(previewGuest) : template.fromName;

  return (
    <div>
      <div className="page-header"><div><h1>Invitations</h1><p>{event.name}</p></div></div>

      {TEST_MODE && <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", padding: "0.75rem 1rem", borderRadius: "var(--radius)", fontSize: "0.875rem", marginBottom: "1rem" }}><strong>Test Mode:</strong> Emails log to console.</div>}
      {!TRACKING_PIXEL_URL && <div style={{ background: "var(--navy-light)", border: "1px solid var(--navy)", color: "var(--navy)", padding: "0.625rem 1rem", borderRadius: "var(--radius)", fontSize: "0.8125rem", marginBottom: "1rem" }}>📬 <strong>Email open tracking</strong> is not yet active. Set up a Cloudflare Worker and add the URL to <code>TRACKING_PIXEL_URL</code> in <code>InvitationComposer.jsx</code>.</div>}
      {sendResult && <div className={sendResult.failed === 0 ? "success-msg" : "error-msg"}>{sendResult.sent} sent{sendResult.failed > 0 ? `, ${sendResult.failed} failed` : ""}.</div>}

      <div className="tabs">
        <button className={`tab ${tab === "compose" ? "active" : ""}`} onClick={() => setTab("compose")}>Compose</button>
        <button className={`tab ${tab === "recipients" ? "active" : ""}`} onClick={() => setTab("recipients")}>Recipients ({targets.length})</button>
      </div>

      {tab === "compose" && (
        <div className="compose-layout">
          <div>
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-header"><h2>Sender & Subject</h2></div>
              <div className="card-body">
                <div className="form-group">
                  <label>From Name</label>
                  <input className="form-input" value={template.fromName} onChange={set("fromName")} placeholder="e.g. CSPC Events, Ben Pickert" disabled={template.fromStaffPoc} />
                </div>
                <label className="checkbox-label" style={{ marginBottom: "0.875rem" }}>
                  <input type="checkbox" checked={template.fromStaffPoc || false} onChange={set("fromStaffPoc")} />
                  <span>Use each guest's <strong>Staff POC</strong> as the sender name</span>
                </label>
                {template.fromStaffPoc && <div style={{ fontSize: "0.8125rem", color: "var(--green)", background: "var(--green-light)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)", marginBottom: "0.875rem" }}>✓ Each email will appear from the guest's assigned POC.</div>}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Subject Line</label>
                  <input className="form-input" value={template.subject} onChange={set("subject")} />
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-header"><h2>Body</h2></div>
              <div className="card-body">
                <div className="form-group">
                  <label>Insert merge field at cursor</label>
                  <div className="merge-field-list">
                    {MERGE_FIELDS.map((m) => (
                      <button key={m.token} type="button" className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.7rem", padding: "0.1875rem 0.5rem", border: "1px solid var(--gray-200)", ...(m.highlight ? { background: "var(--navy-light)", color: "var(--navy)", borderColor: "var(--navy)" } : {}) }}
                        onClick={() => insertAtCursor(m.token)}>{m.label}</button>
                    ))}
                  </div>
                </div>
                <textarea id="email-body-textarea" className="form-textarea" style={{ minHeight: 240, fontFamily: "monospace", fontSize: "0.875rem" }} value={template.body} onChange={set("body")} />
                <div className="form-group" style={{ marginTop: "0.875rem", marginBottom: 0 }}>
                  <label>RSVP Button Label</label>
                  <input className="form-input" value={template.buttonText || "RSVP Now"} onChange={set("buttonText")} placeholder="RSVP Now" style={{ maxWidth: 240 }} />
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-header"><h2>Attachments</h2></div>
              <div className="card-body">
                <input type="file" id="attach-upload" style={{ display: "none" }} onChange={uploadAttachment} />
                <button className="btn btn-secondary btn-sm" onClick={() => document.getElementById("attach-upload").click()} disabled={uploadProgress !== null}>
                  {uploadProgress !== null ? `Uploading ${uploadProgress}%...` : "＋ Add Attachment"}
                </button>
                {uploadProgress !== null && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${uploadProgress}%` }} /></div>
                  </div>
                )}
                {(template.attachments || []).length > 0 && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                    {template.attachments.map((a) => (
                      <div key={a.name} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                        <span>📎 {a.name}</span>
                        <span style={{ color: "var(--gray-400)", fontSize: "0.75rem" }}>({Math.round(a.size / 1024)} KB)</span>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)", padding: "0.125rem 0.375rem" }} onClick={() => removeAttachment(a.name)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="form-hint" style={{ marginTop: "0.5rem" }}>Max 10MB per file. If uploads fail, Firebase Storage CORS may need to be configured — see README.</div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2>Preview As</h2></div>
              <div className="card-body">
                <select className="form-select" style={{ marginBottom: "0.875rem" }} value={previewGuest?.id || ""} onChange={(e) => setPreviewGuest(guests.find((g) => g.id === e.target.value))}>
                  {guests.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}{g.staffPoc ? ` — ${g.staffPoc}` : ""}</option>)}
                </select>
                <button className="btn btn-secondary" onClick={sendPreview} disabled={sendingPreview || !previewGuest}>
                  {sendingPreview ? "Sending..." : `Send preview to ${user?.email || "me"}`}
                </button>
                {previewResult && <div style={{ marginTop: "0.625rem", fontSize: "0.8125rem", color: previewResult.ok ? "var(--green)" : "var(--red)" }}>{previewResult.ok ? `✓ Preview sent to ${previewResult.email}` : `Error: ${previewResult.error}`}</div>}
              </div>
            </div>
          </div>

          <div>
            <div className="card" style={{ position: "sticky", top: "72px" }}>
              <div className="card-header">
                <h2>Live Preview</h2>
                {previewGuest && <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)" }}>From: <strong>{previewFromName}</strong></span>}
              </div>
              <div style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", overflow: "hidden" }}>
                {previewGuest ? <iframe srcDoc={previewHtml} title="Email Preview" style={{ width: "100%", height: 560, border: "none" }} /> : <div className="empty-state" style={{ padding: "3rem" }}>Add guests to preview</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "recipients" && (
        <div>
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <div className="card-header"><h2>Who to Send To</h2></div>
            <div className="card-body">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.125rem" }}>
                {[
                  { val: "unsent", label: `Not yet received an email (${guests.filter((g) => !g.emailSent).length})` },
                  { val: "all", label: `Everyone — resend to all (${guests.length})` },
                  { val: "attending", label: `Attending guests only (${guests.filter((g) => g.rsvpStatus === "yes").length})` },
                  { val: "pending", label: `Haven't responded yet (${guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending").length})` },
                  { val: "custom", label: "Select specific guests" },
                ].map((opt) => <label key={opt.val} className="checkbox-label"><input type="radio" name="sendTo" value={opt.val} checked={selectedGuests === opt.val} onChange={() => setSelectedGuests(opt.val)} />{opt.label}</label>)}
              </div>

              {eventParts.length > 1 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>FILTER BY PART</div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button className={`btn btn-sm ${filterPart === "all" ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilterPart("all")}>All parts</button>
                    {eventParts.map((part) => <button key={part.id} onClick={() => setFilterPart(filterPart === part.id ? "all" : part.id)} className={`btn btn-sm ${filterPart === part.id ? "btn-primary" : "btn-secondary"}`}>{part.name} only</button>)}
                  </div>
                </div>
              )}

              {eventTags.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>FILTER BY TAG</div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button className={`btn btn-sm ${filterTag === "all" ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilterTag("all")}>All</button>
                    {eventTags.map((tag) => <button key={tag.id} onClick={() => setFilterTag(filterTag === tag.id ? "all" : tag.id)} style={{ padding: "0.3125rem 0.75rem", borderRadius: "99px", fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer", border: "1.5px solid " + tag.color, background: filterTag === tag.id ? tag.color : tag.color + "22", color: filterTag === tag.id ? "white" : tag.color }}>{tag.name}</button>)}
                  </div>
                </div>
              )}

              {selectedGuests === "custom" && (
                <table className="data-table" style={{ marginTop: "0.75rem" }}>
                  <thead><tr><th>Select</th><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                  <tbody>
                    {guests.map((g) => (
                      <tr key={g.id}>
                        <td><input type="checkbox" checked={customIds.has(g.id)} onChange={() => setCustomIds((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })} /></td>
                        <td style={{ fontWeight: 600 }}>{g.firstName} {g.lastName}</td>
                        <td style={{ fontSize: "0.875rem", color: "var(--gray-500)" }}>{g.email}</td>
                        <td><span className={`badge ${g.emailSent ? "badge-sent" : "badge-pending"}`}>{g.emailSent ? "Sent" : "Not sent"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button className="btn btn-primary btn-lg" onClick={sendAll} disabled={sending || targets.length === 0}>
              {sending ? "Sending..." : `Send to ${targets.length} Guest${targets.length !== 1 ? "s" : ""}`}
            </button>
            <button className="btn btn-secondary" onClick={saveTemplate}>Save Draft</button>
            <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)" }}>From: <strong>{previewFromName}</strong> &lt;events@thepresidency.org&gt;</span>
          </div>
        </div>
      )}
    </div>
  );
}
