import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  doc, getDoc, getDocs, query, collection, where, addDoc,
  updateDoc, deleteDoc, onSnapshot, serverTimestamp, Timestamp
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage, TEST_MODE, EMAILJS_CONFIG } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import emailjs from "@emailjs/browser";
import EmailDesigner, { blocksToHtml, createBlock } from "../components/EmailDesigner";

const TRACKING_PIXEL_URL = null;
const LOGO_URL = "https://bpickert99.github.io/cspc-events/cspc-logo.png";

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

function ResizablePreview({ children }) {
  const [width, setWidth] = useState(480);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = (e) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      setWidth(Math.max(320, Math.min(900, startW.current + delta)));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  return (
    <div style={{ display: "flex", flexShrink: 0, width }}>
      <div
        onMouseDown={onMouseDown}
        style={{ width: 6, cursor: "ew-resize", background: "var(--gray-200)", borderRadius: 3, flexShrink: 0, margin: "0 6px 0 0", transition: "background 0.15s" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--navy)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--gray-200)"; }}
        title="Drag to resize preview"
      />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function resolveMerge(text, guest, event, baseUrl, buttonText) {
  const dateStr = event.date
    ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : "TBD";
  const rsvpLink = `${baseUrl}#/rsvp/${guest.rsvpToken}`;
  const btnLabel = buttonText || "RSVP Now";
  const rsvpButton = `<div style="text-align:center;margin:12px 0 4px;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${rsvpLink}" style="height:44px;v-text-anchor:middle;width:180px;" arcsize="18%" strokecolor="#0F1A45" fillcolor="#1B2B6B"><w:anchorlock/><center style="color:#FFFFFF;font-family:sans-serif;font-size:15px;font-weight:700;">${btnLabel}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${rsvpLink}" style="display:inline-block;background:#1B2B6B;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.01em;mso-hide:all;">${btnLabel}</a><!--<![endif]-->
</div>`;
  return (text || "")
    .replace(/{{firstName}}/g, guest.firstName || "")
    .replace(/{{lastName}}/g, guest.lastName || "")
    .replace(/{{fullName}}/g, `${guest.title ? guest.title + " " : ""}${guest.firstName} ${guest.lastName}`.trim())
    .replace(/{{staffPOC}}/g, guest.staffPoc || "")
    .replace(/{{eventName}}/g, event.name || "")
    .replace(/{{eventDate}}/g, dateStr)
    .replace(/{{eventLocation}}/g, event.location || "")
    .replace(/{{rsvpButton}}/g, rsvpButton)
    .replace(/{{rsvpLink}}/g, rsvpLink);
}

function buildEmailHtmlWrapper(bodyHtml, guest, attachments) {
  const pixelHtml = TRACKING_PIXEL_URL && guest ? `<img src="${TRACKING_PIXEL_URL.replace("{{guestId}}", guest.id)}" width="1" height="1" style="display:none;" alt="" />` : "";
  const attHtml = (attachments || []).length
    ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid #E4E8F0;font-size:13px;color:#6B7A99;"><strong>Attachments:</strong> ${attachments.map((a) => `<a href="${a.url}" style="color:#1B2B6B;">${a.name}</a>`).join(" &nbsp;|&nbsp; ")}</div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F6F8FC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
${pixelHtml}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FC;padding:32px 16px;"><tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(15,26,69,.10);">
  <tr><td style="background:#FFFFFF;padding:18px 32px;text-align:center;border-bottom:3px solid #1B2B6B;">
    <img src="${LOGO_URL}" alt="CSPC" style="height:42px;" />
  </td></tr>
  <tr><td style="padding:28px 36px;color:#1A202C;font-size:15px;line-height:1.75;">${bodyHtml}${attHtml}</td></tr>
  <tr><td style="background:#F6F8FC;padding:14px 36px;text-align:center;font-size:12px;color:#94A0B8;border-top:1px solid #E4E8F0;">
    Center for the Study of the Presidency and Congress &nbsp;·&nbsp; Washington, D.C.<br>
    601 13th Street NW, Suite 940N, Washington, DC 20005
  </td></tr>
</table></td></tr></table></body></html>`;
}

const DEFAULT_BODY = (ev) =>
  `Dear {{fullName}},\n\nWe are pleased to invite you to ${ev.name}${ev.date ? " on {{eventDate}}" : ""}${ev.location ? " at {{eventLocation}}" : ""}.\n\nPlease RSVP using the button below.\n\n{{rsvpButton}}\n\nWarm regards,\n{{staffPOC}}`;

const EMPTY_CAMPAIGN = (ev) => ({
  subject: `You're invited: ${ev?.name || ""}`,
  body: DEFAULT_BODY(ev || {}),
  blocks: ev ? [createBlock("text"), createBlock("button")] : [],
  fromName: "CSPC Events",
  fromStaffPoc: false,
  buttonText: "RSVP Now",
  attachments: [],
  editorMode: "designer",
  selectedGuests: "unsent",
  filterTag: "all",
  filterPart: "all",
});

export default function InvitationComposer() {
  const { id } = useParams();
  const { user } = useAuth();

  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [view, setView] = useState("inbox");          // "inbox" | "compose" | "sent-detail"
  const [activeCampaignId, setActiveCampaignId] = useState(null);
  const [campaign, setCampaign] = useState(null);     // current working draft
  const [previewGuest, setPreviewGuest] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendingPreview, setSendingPreview] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [scheduleFor, setScheduleFor] = useState("");
  const [scheduledSends, setScheduledSends] = useState([]);
  const [sentRecipients, setSentRecipients] = useState([]);

  const baseUrl = window.location.href.split("#")[0];

  useEffect(() => {
    getDoc(doc(db, "events", id)).then((s) => { if (s.exists()) setEvent({ id: s.id, ...s.data() }); });
    getDocs(query(collection(db, "guests"), where("eventId", "==", id))).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setGuests(list);
      if (list.length > 0) setPreviewGuest(list[0]);
    });
    const unsub = onSnapshot(query(collection(db, "campaigns"), where("eventId", "==", id)), (snap) => {
      setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)));
    });
    const schedUnsub = onSnapshot(query(collection(db, "scheduledSends"), where("eventId", "==", id)), (snap) => {
      setScheduledSends(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => { unsub(); schedUnsub(); };
  }, [id]);

  // ─── Campaign helpers ──────────────────────────────────────────────────────
  const openNewDraft = () => {
    setActiveCampaignId(null);
    setCampaign(EMPTY_CAMPAIGN(event));
    setSendResult(null);
    setPreviewResult(null);
    setView("compose");
  };

  const openDraft = (c) => {
    setActiveCampaignId(c.id);
    setCampaign({ ...c });
    setSendResult(null);
    setPreviewResult(null);
    setView("compose");
  };

  const openSentDetail = async (c) => {
    setActiveCampaignId(c.id);
    setCampaign(c);
    // Load recipients from emailLogs for this campaign
    const snap = await getDocs(query(collection(db, "emailLogs"), where("campaignId", "==", c.id)));
    setSentRecipients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setView("sent-detail");
  };

  const saveDraft = async () => {
    if (!campaign) return;
    const data = { ...campaign, eventId: id, status: "draft", updatedAt: serverTimestamp() };
    if (activeCampaignId) {
      await updateDoc(doc(db, "campaigns", activeCampaignId), data);
    } else {
      const ref = await addDoc(collection(db, "campaigns"), { ...data, createdBy: user.email, createdAt: serverTimestamp() });
      setActiveCampaignId(ref.id);
    }
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 2500);
  };

  const deleteDraft = async (campaignId) => {
    if (!confirm("Delete this draft?")) return;
    await deleteDoc(doc(db, "campaigns", campaignId));
    if (activeCampaignId === campaignId) setView("inbox");
  };

  const set = (field) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setCampaign((c) => ({ ...c, [field]: val }));
  };

  const resolveFromName = (guest) => {
    if (campaign?.fromStaffPoc && guest.staffPoc) return guest.staffPoc;
    return campaign?.fromName || "CSPC Events";
  };

  const getBodyHtml = (guest) => {
    if (campaign?.editorMode === "designer" && campaign?.blocks?.length > 0) {
      const dateStr = event?.date ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "TBD";
      const resolver = (text) => (text || "")
        .replace(/{{firstName}}/g, guest.firstName || "")
        .replace(/{{lastName}}/g, guest.lastName || "")
        .replace(/{{fullName}}/g, `${guest.title ? guest.title + " " : ""}${guest.firstName} ${guest.lastName}`.trim())
        .replace(/{{staffPOC}}/g, guest.staffPoc || "")
        .replace(/{{eventName}}/g, event?.name || "")
        .replace(/{{eventDate}}/g, dateStr)
        .replace(/{{eventLocation}}/g, event?.location || "")
        .replace(/{{rsvpLink}}/g, `${baseUrl}#/rsvp/${guest.rsvpToken}`);
      return `<div>${blocksToHtml(campaign.blocks, resolver, event, guest.invitedParts || [])}</div>`;
    }
    return resolveMerge(campaign?.body || "", guest, event, baseUrl, campaign?.buttonText);
  };

  const getTargetGuests = () => {
    let base;
    const sel = campaign?.selectedGuests || "unsent";
    if (sel === "unsent") base = guests.filter((g) => !g.emailSent);
    else if (sel === "all") base = guests;
    else if (sel === "attending") base = guests.filter((g) => g.rsvpStatus === "yes");
    else if (sel === "pending") base = guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending");
    else base = guests;
    if (campaign?.filterTag && campaign.filterTag !== "all") base = base.filter((g) => (g.tags || []).includes(campaign.filterTag));
    if (campaign?.filterPart && campaign.filterPart !== "all") base = base.filter((g) => (g.invitedParts || []).includes(campaign.filterPart));
    return base;
  };

  const sendPreview = async () => {
    if (!previewGuest || !campaign) return alert("No guest selected.");
    setSendingPreview(true); setPreviewResult(null);
    const html = buildEmailHtmlWrapper(getBodyHtml(previewGuest), previewGuest, campaign.attachments || []);
    const subject = `[PREVIEW] ${resolveMerge(campaign.subject || "", previewGuest, event, baseUrl, campaign.buttonText)}`;
    const fromName = resolveFromName(previewGuest);
    try {
      if (TEST_MODE) {
        console.log(`[PREVIEW] To: ${user.email} | ${subject}`);
        await new Promise((r) => setTimeout(r, 600));
      } else {
        await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, { to_email: user.email, subject, message: html, from_name: fromName }, EMAILJS_CONFIG.publicKey);
      }
      setPreviewResult({ ok: true, email: user.email });
    } catch (err) { setPreviewResult({ ok: false, error: err.message }); }
    setSendingPreview(false);
  };

  const uploadAttachment = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("File must be under 10MB."); return; }
    setUploadProgress(0);
    try {
      const storageRef = ref(storage, `attachments/${id}/${Date.now()}_${file.name}`);
      const task = uploadBytesResumable(storageRef, file);
      await new Promise((resolve, reject) => { task.on("state_changed", (s) => setUploadProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)), reject, resolve); });
      const url = await getDownloadURL(storageRef);
      setCampaign((c) => ({ ...c, attachments: [...(c.attachments || []), { name: file.name, url, size: file.size }] }));
    } catch (err) { alert("Upload failed: " + err.message); }
    finally { setUploadProgress(null); e.target.value = ""; }
  };

  const sendAll = async () => {
    const targets = getTargetGuests();
    if (!targets.length) return alert("No guests to send to.");
    if (!confirm(`Send to ${targets.length} guest(s)?`)) return;
    setSending(true); setSendResult(null);
    await saveDraft();
    let sent = 0, failed = 0;
    const camId = activeCampaignId;
    for (const guest of targets) {
      try {
        const fromName = resolveFromName(guest);
        const html = buildEmailHtmlWrapper(getBodyHtml(guest), guest, campaign.attachments || []);
        const subject = resolveMerge(campaign.subject || "", guest, event, baseUrl, campaign.buttonText);
        if (TEST_MODE) {
          console.log(`[TEST] To: ${guest.email}`);
          await new Promise((r) => setTimeout(r, 80));
        } else {
          await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, { to_email: guest.email, subject, message: html, from_name: fromName }, EMAILJS_CONFIG.publicKey);
        }
        await updateDoc(doc(db, "guests", guest.id), { emailSent: true, emailSentAt: serverTimestamp() });
        await addDoc(collection(db, "emailLogs"), {
          eventId: id, campaignId: camId || null, guestId: guest.id,
          guestName: `${guest.firstName} ${guest.lastName}`, guestEmail: guest.email,
          subject, fromName, status: "sent", sentAt: serverTimestamp(), sentBy: user.email,
        });
        sent++;
      } catch (err) {
        await addDoc(collection(db, "emailLogs"), {
          eventId: id, campaignId: camId || null, guestId: guest.id,
          guestName: `${guest.firstName} ${guest.lastName}`, guestEmail: guest.email,
          subject: campaign.subject || "", fromName: resolveFromName(guest),
          status: "failed", sentAt: serverTimestamp(), sentBy: user.email,
        });
        failed++;
      }
    }
    // Mark campaign as sent
    if (camId) {
      await updateDoc(doc(db, "campaigns", camId), {
        status: "sent", sentAt: serverTimestamp(), sentBy: user.email,
        recipientCount: sent, updatedAt: serverTimestamp(),
      });
    }
    setSendResult({ sent, failed });
    setSending(false);
    if (failed === 0) setTimeout(() => setView("inbox"), 2000);
  };

  const scheduleSend = async () => {
    if (!scheduleFor) return alert("Please select a date and time.");
    const targets = getTargetGuests();
    if (!targets.length) return alert("No guests match the current filters.");
    const scheduledAt = Timestamp.fromDate(new Date(scheduleFor));
    if (scheduledAt.toDate() <= new Date()) return alert("Scheduled time must be in the future.");
    await saveDraft();
    await addDoc(collection(db, "scheduledSends"), {
      eventId: id, campaignId: activeCampaignId || null,
      scheduledFor: scheduledAt, status: "pending",
      recipientCount: targets.length, recipientIds: targets.map((g) => g.id),
      createdBy: user.email, createdAt: serverTimestamp(),
    });
    setScheduleFor("");
    alert(`Scheduled for ${new Date(scheduleFor).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`);
  };

  const cancelSchedule = async (schedId) => {
    if (!confirm("Cancel this scheduled send?")) return;
    await updateDoc(doc(db, "scheduledSends", schedId), { status: "cancelled", cancelledAt: serverTimestamp() });
  };

  const insertAtCursor = (token) => {
    const textarea = document.getElementById("email-body-textarea");
    if (!textarea) { setCampaign((c) => ({ ...c, body: (c.body || "") + token })); return; }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setCampaign((c) => ({ ...c, body: c.body.slice(0, start) + token + c.body.slice(end) }));
    setTimeout(() => { textarea.focus(); textarea.selectionStart = textarea.selectionEnd = start + token.length; }, 0);
  };

  if (!event) return <div className="loading">Loading…</div>;

  const eventTags = event.tags || [];
  const eventParts = event.parts || [];
  const targets = getTargetGuests();
  const pendingScheduled = scheduledSends.filter((s) => s.status === "pending");

  const previewHtml = previewGuest && campaign
    ? buildEmailHtmlWrapper(getBodyHtml(previewGuest), previewGuest, campaign.attachments || [])
    : "";
  const previewFromName = previewGuest && campaign ? resolveFromName(previewGuest) : "CSPC Events";

  const drafts = campaigns.filter((c) => c.status === "draft" || !c.status);
  const sentCampaigns = campaigns.filter((c) => c.status === "sent");

  // ─── INBOX VIEW ─────────────────────────────────────────────────────────────
  if (view === "inbox") {
    return (
      <div>
        <div className="page-header">
          <div><h1>Invitations</h1><p>{event.name}</p></div>
          <button className="btn btn-primary" onClick={openNewDraft}>＋ New Message</button>
        </div>

        {TEST_MODE && <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", padding: "0.625rem 1rem", borderRadius: "var(--radius)", fontSize: "0.875rem", marginBottom: "1rem" }}><strong>Test Mode:</strong> Emails log to console only.</div>}

        {/* Scheduled sends */}
        {pendingScheduled.length > 0 && (
          <div style={{ marginBottom: "1.25rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Scheduled</div>
            {pendingScheduled.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "var(--radius)", marginBottom: "0.375rem" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>📅 Sending {fmtDateTime(s.scheduledFor)} · {s.recipientCount} recipient{s.recipientCount !== 1 ? "s" : ""}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--gray-400)" }}>Scheduled by {s.createdBy}</div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => cancelSchedule(s.id)}>Cancel</button>
              </div>
            ))}
          </div>
        )}

        {/* Drafts */}
        {drafts.length > 0 && (
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Drafts</div>
            <div className="card">
              {drafts.map((c, i) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", padding: "0.875rem 1rem", borderBottom: i < drafts.length - 1 ? "1px solid var(--gray-100)" : "none", gap: "1rem" }}>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => openDraft(c)}>
                    <div style={{ fontWeight: 600, fontSize: "0.9375rem", color: "var(--gray-800)" }}>
                      ✏️ {c.subject || "(No subject)"}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--gray-400)", marginTop: "0.125rem" }}>
                      Last edited {fmtDate(c.updatedAt)} · {c.editorMode === "designer" ? "Designer" : "Simple"} mode
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => openDraft(c)}>Edit & Send</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => deleteDraft(c.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sent */}
        {sentCampaigns.length > 0 ? (
          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Sent</div>
            <div className="card">
              {sentCampaigns.map((c, i) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", padding: "0.875rem 1rem", borderBottom: i < sentCampaigns.length - 1 ? "1px solid var(--gray-100)" : "none", gap: "1rem", cursor: "pointer" }} onClick={() => openSentDetail(c)}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.9375rem", color: "var(--gray-800)" }}>
                      ✉️ {c.subject || "(No subject)"}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--gray-400)", marginTop: "0.125rem" }}>
                      Sent {fmtDateTime(c.sentAt)} · {c.recipientCount || 0} recipient{(c.recipientCount || 0) !== 1 ? "s" : ""} · By {c.sentBy}
                    </div>
                  </div>
                  <span style={{ fontSize: "0.8rem", color: "var(--gray-400)" }}>View →</span>
                </div>
              ))}
            </div>
          </div>
        ) : drafts.length === 0 && (
          <div className="empty-state">
            <div className="icon">✉️</div>
            <h3>No messages yet</h3>
            <p>Create your first invitation message.</p>
            <button className="btn btn-primary" style={{ marginTop: "1rem" }} onClick={openNewDraft}>＋ New Message</button>
          </div>
        )}
      </div>
    );
  }

  // ─── SENT DETAIL VIEW ────────────────────────────────────────────────────────
  if (view === "sent-detail") {
    // Build a preview of the email using a representative guest (first recipient)
    const firstRecipient = sentRecipients[0];
    const previewGuestForSent = firstRecipient ? guests.find((g) => g.id === firstRecipient.guestId) || null : null;
    const sentPreviewHtml = previewGuestForSent && campaign
      ? buildEmailHtmlWrapper(getBodyHtml(previewGuestForSent), previewGuestForSent, campaign.attachments || [])
      : null;

    return (
      <div>
        <div className="page-header">
          <div>
            <button className="btn btn-ghost btn-sm" style={{ marginBottom: "0.5rem" }} onClick={() => setView("inbox")}>← Back to Invitations</button>
            <h1>{campaign?.subject || "(No subject)"}</h1>
            <p>Sent {fmtDateTime(campaign?.sentAt)} · {campaign?.recipientCount || 0} recipients · By {campaign?.sentBy}</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.25rem", alignItems: "start" }}>
          {/* Recipients table */}
          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
              Recipients ({sentRecipients.length})
            </div>
            {sentRecipients.length === 0 ? (
              <div className="empty-state"><h3>No recipient records found</h3></div>
            ) : (
              <div className="card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Sent At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sentRecipients.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600 }}>{r.guestName}</td>
                        <td style={{ fontSize: "0.875rem", color: "var(--gray-500)" }}>{r.guestEmail}</td>
                        <td>
                          <span className={`badge ${r.status === "failed" ? "badge-bounced" : "badge-yes"}`}>
                            {r.status === "failed" ? "Failed" : "Sent"}
                          </span>
                        </td>
                        <td style={{ fontSize: "0.8125rem", color: "var(--gray-500)" }}>{fmtDateTime(r.sentAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Email preview */}
          <div style={{ position: "sticky", top: "72px" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
              Email Preview
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              {sentPreviewHtml ? (
                <iframe srcDoc={sentPreviewHtml} title="Sent email preview" style={{ width: "100%", height: 560, border: "none", display: "block" }} />
              ) : (
                <div className="empty-state" style={{ padding: "2rem" }}>
                  <p style={{ fontSize: "0.875rem", color: "var(--gray-400)" }}>Preview unavailable — campaign data may be in an older format.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── COMPOSE VIEW ────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: "0.5rem" }} onClick={() => setView("inbox")}>← Back to Invitations</button>
          <h1>{activeCampaignId ? "Edit Draft" : "New Message"}</h1>
          <p>{event.name}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={saveDraft} style={{ background: draftSaved ? "var(--green)" : undefined, color: draftSaved ? "white" : undefined, transition: "all 0.3s" }}>
            {draftSaved ? "Saved ✓" : "Save Draft"}
          </button>
        </div>
      </div>

      {TEST_MODE && <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", padding: "0.625rem 1rem", borderRadius: "var(--radius)", fontSize: "0.875rem", marginBottom: "1rem" }}><strong>Test Mode:</strong> Emails log to console only.</div>}
      {sendResult && (
        <div className={sendResult.failed === 0 ? "success-msg" : "error-msg"} style={{ marginBottom: "1rem" }}>
          {sendResult.sent} sent{sendResult.failed > 0 ? `, ${sendResult.failed} failed` : ""}. {sendResult.failed === 0 && "Returning to inbox…"}
        </div>
      )}

      {/* ─── Sender bar ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="card-body" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "2", minWidth: 180 }}>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>From Name</label>
            <input className="form-input" value={campaign?.fromName || ""} onChange={set("fromName")} disabled={campaign?.fromStaffPoc} placeholder="CSPC Events" />
          </div>
          <label className="checkbox-label" style={{ paddingBottom: "0.5rem", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={campaign?.fromStaffPoc || false} onChange={set("fromStaffPoc")} />
            <span style={{ fontSize: "0.875rem" }}>Use Staff POC per guest</span>
          </label>
          <div style={{ flex: "3", minWidth: 220 }}>
            <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Subject</label>
            <input className="form-input" value={campaign?.subject || ""} onChange={set("subject")} />
          </div>
          <div style={{ display: "flex", border: "1.5px solid var(--gray-200)", borderRadius: "var(--radius)", overflow: "hidden", flexShrink: 0 }}>
            <button className="btn btn-sm" onClick={() => setCampaign((c) => ({ ...c, editorMode: "designer" }))}
              style={{ borderRadius: 0, background: campaign?.editorMode !== "simple" ? "var(--navy)" : "var(--white)", color: campaign?.editorMode !== "simple" ? "var(--white)" : "var(--gray-600)", border: "none" }}>
              🎨 Designer
            </button>
            <button className="btn btn-sm" onClick={() => setCampaign((c) => ({ ...c, editorMode: "simple" }))}
              style={{ borderRadius: 0, background: campaign?.editorMode === "simple" ? "var(--navy)" : "var(--white)", color: campaign?.editorMode === "simple" ? "var(--white)" : "var(--gray-600)", border: "none", borderLeft: "1px solid var(--gray-200)" }}>
              &lt;/&gt; Simple
            </button>
          </div>
        </div>
      </div>

      {/* ─── Designer / Simple mode ──────────────────────────────── */}
      {campaign?.editorMode !== "simple" ? (
        <>
          <EmailDesigner
            blocks={campaign?.blocks || []}
            onChange={(fn) => setCampaign((c) => ({ ...c, blocks: typeof fn === "function" ? fn(c.blocks || []) : fn }))}
            subject={campaign?.subject || ""}
            onSubjectChange={(v) => setCampaign((c) => ({ ...c, subject: v }))}
            buttonText={campaign?.buttonText || "RSVP Now"}
            onButtonTextChange={(v) => setCampaign((c) => ({ ...c, buttonText: v }))}
            event={event}
          />
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <select className="form-select" style={{ width: "auto" }} value={previewGuest?.id || ""} onChange={(e) => setPreviewGuest(guests.find((g) => g.id === e.target.value))}>
              {guests.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={sendPreview} disabled={sendingPreview || !previewGuest}>
              {sendingPreview ? "Sending…" : `Send preview to ${user?.email || "me"}`}
            </button>
            {previewResult && <span style={{ fontSize: "0.8125rem", color: previewResult.ok ? "var(--green)" : "var(--red)" }}>{previewResult.ok ? `✓ Preview sent to ${previewResult.email}` : `Error: ${previewResult.error}`}</span>}
          </div>
        </>
      ) : (
        <div className="compose-layout" ref={(el) => { if (el) el._composeEl = el; }}>
          <div style={{ flex: "1 1 0", minWidth: 320 }}>
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
                <textarea id="email-body-textarea" className="form-textarea" style={{ minHeight: 260, fontFamily: "monospace", fontSize: "0.875rem" }} value={campaign?.body || ""} onChange={set("body")} />
                <div className="form-group" style={{ marginTop: "0.875rem", marginBottom: 0 }}>
                  <label>RSVP Button Label</label>
                  <input className="form-input" value={campaign?.buttonText || "RSVP Now"} onChange={set("buttonText")} style={{ maxWidth: 240 }} />
                </div>
              </div>
            </div>
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-header"><h2>Attachments</h2></div>
              <div className="card-body">
                <input type="file" id="attach-upload" style={{ display: "none" }} onChange={uploadAttachment} />
                <button className="btn btn-secondary btn-sm" onClick={() => document.getElementById("attach-upload").click()} disabled={uploadProgress !== null}>
                  {uploadProgress !== null ? `Uploading ${uploadProgress}%…` : "＋ Add Attachment"}
                </button>
                {uploadProgress !== null && <div style={{ marginTop: "0.5rem" }}><div className="progress-bar"><div className="progress-fill" style={{ width: `${uploadProgress}%` }} /></div></div>}
                {(campaign?.attachments || []).length > 0 && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                    {campaign.attachments.map((a) => (
                      <div key={a.name} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                        <span>📎 {a.name}</span>
                        <span style={{ color: "var(--gray-400)", fontSize: "0.75rem" }}>({Math.round(a.size / 1024)} KB)</span>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)", padding: "0.125rem 0.375rem" }} onClick={() => setCampaign((c) => ({ ...c, attachments: c.attachments.filter((x) => x.name !== a.name) }))}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2>Preview As</h2></div>
              <div className="card-body">
                <select className="form-select" style={{ marginBottom: "0.875rem" }} value={previewGuest?.id || ""} onChange={(e) => setPreviewGuest(guests.find((g) => g.id === e.target.value))}>
                  {guests.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}
                </select>
                <button className="btn btn-secondary" onClick={sendPreview} disabled={sendingPreview || !previewGuest}>
                  {sendingPreview ? "Sending…" : `Send preview to ${user?.email || "me"}`}
                </button>
                {previewResult && <div style={{ marginTop: "0.625rem", fontSize: "0.8125rem", color: previewResult.ok ? "var(--green)" : "var(--red)" }}>{previewResult.ok ? `✓ Preview sent to ${previewResult.email}` : `Error: ${previewResult.error}`}</div>}
              </div>
            </div>
          </div>
          <ResizablePreview>
            <div className="card" style={{ position: "sticky", top: "72px" }}>
              <div className="card-header">
                <h2>Live Preview</h2>
                {previewGuest && <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)" }}>From: <strong>{previewFromName}</strong></span>}
              </div>
              <div style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", overflow: "hidden" }}>
                {previewGuest ? <iframe srcDoc={previewHtml} title="Email Preview" style={{ width: "100%", height: 640, border: "none" }} /> : <div className="empty-state" style={{ padding: "3rem" }}>Add guests to preview</div>}
              </div>
            </div>
          </ResizablePreview>
        </div>
      )}

      {/* ─── Recipients & Send ───────────────────────────────────── */}
      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-header"><h2>Recipients</h2></div>
        <div className="card-body">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginBottom: "1rem" }}>
            {[
              { val: "unsent", label: `Not yet emailed (${guests.filter((g) => !g.emailSent).length})` },
              { val: "all", label: `Everyone — resend to all (${guests.length})` },
              { val: "attending", label: `Attending only (${guests.filter((g) => g.rsvpStatus === "yes").length})` },
              { val: "pending", label: `No response yet (${guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending").length})` },
            ].map((opt) => (
              <label key={opt.val} className="checkbox-label">
                <input type="radio" name="sendTo" value={opt.val} checked={(campaign?.selectedGuests || "unsent") === opt.val}
                  onChange={() => setCampaign((c) => ({ ...c, selectedGuests: opt.val }))} />
                {opt.label}
              </label>
            ))}
          </div>

          {eventParts.length > 1 && (
            <div style={{ marginBottom: "0.875rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Filter by Part</div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button className={`btn btn-sm ${(campaign?.filterPart || "all") === "all" ? "btn-primary" : "btn-secondary"}`} onClick={() => setCampaign((c) => ({ ...c, filterPart: "all" }))}>All parts</button>
                {eventParts.map((p) => <button key={p.id} onClick={() => setCampaign((c) => ({ ...c, filterPart: (c.filterPart === p.id ? "all" : p.id) }))} className={`btn btn-sm ${(campaign?.filterPart) === p.id ? "btn-primary" : "btn-secondary"}`}>{p.name} only</button>)}
              </div>
            </div>
          )}

          {eventTags.length > 0 && (
            <div style={{ marginBottom: "0.875rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Filter by Tag</div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button className={`btn btn-sm ${(campaign?.filterTag || "all") === "all" ? "btn-primary" : "btn-secondary"}`} onClick={() => setCampaign((c) => ({ ...c, filterTag: "all" }))}>All</button>
                {eventTags.map((tag) => <button key={tag.id} onClick={() => setCampaign((c) => ({ ...c, filterTag: c.filterTag === tag.id ? "all" : tag.id }))} style={{ padding: "0.3rem 0.75rem", borderRadius: 99, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer", border: `1.5px solid ${tag.color}`, background: (campaign?.filterTag) === tag.id ? tag.color : tag.color + "22", color: (campaign?.filterTag) === tag.id ? "white" : tag.color }}>{tag.name}</button>)}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", paddingTop: "0.875rem", borderTop: "1px solid var(--gray-100)" }}>
            <button className="btn btn-primary btn-lg" onClick={sendAll} disabled={sending || targets.length === 0}>
              {sending ? "Sending…" : `Send to ${targets.length} Guest${targets.length !== 1 ? "s" : ""}`}
            </button>
            <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)" }}>From: <strong>{previewFromName}</strong></span>
          </div>

          {/* Schedule */}
          <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--gray-100)" }}>
            <div style={{ fontWeight: 700, color: "var(--gray-700)", marginBottom: "0.5rem", fontSize: "0.9rem" }}>📅 Schedule Send</div>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", display: "block", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Send At</label>
                <input className="form-input" type="datetime-local" value={scheduleFor} onChange={(e) => setScheduleFor(e.target.value)} min={new Date().toISOString().slice(0, 16)} />
              </div>
              <button className="btn btn-secondary" onClick={scheduleSend} disabled={!scheduleFor || targets.length === 0}>
                Schedule ({targets.length})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
