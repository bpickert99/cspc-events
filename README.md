# CSPC Events

Internal event management system for the Center for the Study of the Presidency and Congress. Handles invitations, RSVPs, guest tracking, and seating for all CSPC events.

---

## What This Does

- **Create events** with multiple parts (e.g. Reception + Dinner) and custom RSVP fields
- **Manage guests** per event: individual add or CSV import, plus-one eligibility, staff POC assignment, per-part invitation
- **Send branded invitations** from events@thepresidency.org with mail-merge personalization and PDF attachments
- **Personalized RSVP pages** — each guest gets a unique link showing only the questions relevant to them
- **Tracking dashboard** — real-time view of who opened, responded, attended which parts, with manual override capability and notes
- **Drag-and-drop seating manager** — tables with editable seat counts, head table designation, plus-ones visually linked

---

## Quick Setup (Test Mode)

### Step 1 — Create a Firebase project

1. Go to [firebase.google.com](https://firebase.google.com) and sign in with your Google account
2. Click **Add project**, name it `cspc-events`, disable Google Analytics, click **Create**
3. In the left sidebar, click **Build → Firestore Database**
   - Click **Create database**
   - Choose **Start in test mode** (you'll lock this down before going live)
   - Pick `us-east1` as your region, click **Enable**
4. In the left sidebar, click **Build → Storage**
   - Click **Get started**, choose **Test mode**, click **Done**
5. In the left sidebar, click **Build → Authentication**
   - Click **Get started**
   - Under Sign-in providers, enable **Email/Password**
6. Click the gear icon (⚙) → **Project settings**
   - Scroll to **Your apps**, click the `</>` (Web) icon
   - Register the app with nickname `cspc-events`
   - Copy the `firebaseConfig` object shown — you'll need it in a moment

### Step 2 — Add your Firebase credentials

Open `src/firebase.js` and replace the placeholder values with your actual Firebase config:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "cspc-events.firebaseapp.com",
  projectId: "cspc-events",
  storageBucket: "cspc-events.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123",
};
```

### Step 3 — Add the CSPC logo

Place your logo file at `public/cspc-logo.png`. The blue version of the logo works well — it is automatically inverted to white where needed (email headers, top bar).

### Step 4 — Create your GitHub repository

1. Go to [github.com](https://github.com) → **New repository**
2. Name it `cspc-events` (or anything you like)
3. Set it to **Private** — this system should not be publicly browsable
4. Do **not** add a README (you already have one)

Then push this code:

```bash
git init
git add .
git commit -m "Initial CSPC Events build"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cspc-events.git
git push -u origin main
```

### Step 5 — Enable GitHub Pages

1. Go to your repo on GitHub → **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. The deploy workflow (`.github/workflows/deploy.yml`) will run automatically on every push to `main`
4. Your site will be live at: `https://YOUR_USERNAME.github.io/cspc-events/`

### Step 6 — Install dependencies and run locally (optional)

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` — it will hot-reload as you make changes.

### Step 7 — Create your first account

Visit your deployed site, click **Create one**, and register with your email and a password. Anyone on the CSPC team can do the same — the first registration is automatically the admin account.

---

## CSV Import Format

When importing guests in bulk, your CSV should have these columns (order does not matter, headers are case-insensitive):

```
First Name, Last Name, Title, Email, Staff POC, Plus One, Plus One Name, Notes
```

- **Plus One**: enter `yes` to mark a guest as plus-one eligible, anything else (or blank) means no
- **Title**: optional honorific — Senator, Ambassador, Mr., Dr., etc.
- All other fields are optional

**Example row:**
```
Senator,Bob,Corker,bcorker@example.com,Ben,yes,,Special attention: head table candidate
```

---

## Firestore Security Rules (Before Going Live)

The default "test mode" rules allow anyone to read/write. Before using this for real events, replace your Firestore rules with the following. Do this in **Firebase Console → Firestore → Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Staff can read/write events and guests if authenticated
    match /events/{eventId} {
      allow read, write: if request.auth != null;
    }
    match /guests/{guestId} {
      allow read, write: if request.auth != null;
      // Allow unauthenticated write for RSVP submissions (token-gated)
      allow update: if resource.data.rsvpToken == request.resource.data.rsvpToken;
    }
    match /seating/{eventId} {
      allow read, write: if request.auth != null;
    }
    match /emailTemplates/{eventId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Also update your Storage rules in **Firebase Console → Storage → Rules**:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /attachments/{allPaths=**} {
      allow read: if true; // Attachments in emails must be publicly readable
      allow write: if request.auth != null;
    }
  }
}
```

---

## Enabling Real Email Sending (After IT Setup)

Once your IT team has completed the Azure AD app registration:

1. Open `src/firebase.js`
2. Set `TEST_MODE = false`
3. Fill in `GRAPH_CONFIG.clientId` and `GRAPH_CONFIG.tenantId` with the values IT provides
4. In `src/pages/InvitationComposer.jsx`, find the `sendEmailViaGraph` call (currently commented out in the `sendAll` function) and wire in the MSAL token acquisition

The MSAL integration will be a separate addition once you have the Azure credentials — it involves installing `@azure/msal-browser`, acquiring a token silently, and passing it to the existing `sendEmailViaGraph` function that is already written and ready.

**What to tell IT:**
> "We need an Azure AD App Registration for a web application. The app needs the `Mail.Send` delegated permission on the Microsoft Graph API, scoped to the `events@thepresidency.org` shared mailbox. We need the Client ID and Tenant ID returned to us. The redirect URI will be `https://[your-github-pages-url]`."

---

## Adding a Custom Domain Later

If you want `events.thepresidency.org` instead of the GitHub URL:

1. In your Squarespace DNS settings, add a `CNAME` record:
   - Name: `events`
   - Value: `YOUR_USERNAME.github.io`
2. In GitHub → repo Settings → Pages, add your custom domain: `events.thepresidency.org`
3. GitHub will automatically provision an HTTPS certificate

---

## Project Structure

```
src/
  contexts/
    AuthContext.jsx       — Auth state, sign in/out
  pages/
    Login.jsx             — Staff sign in / account creation
    EventList.jsx         — Home: all events
    EventCreate.jsx       — Create or edit an event
    EventDetail.jsx       — Event overview with quick stats
    GuestManager.jsx      — Add, edit, import guests; set per-part invites
    InvitationComposer.jsx — Compose emails, attachments, send
    TrackingDashboard.jsx  — Real-time RSVP monitoring with override/notes
    SeatingManager.jsx    — Drag-and-drop seating with plus-one linking
    RSVPPage.jsx          — Public guest-facing RSVP form (no login required)
  styles/
    global.css            — All CSPC-branded styles
  firebase.js             — Firebase init + config flags
  App.jsx                 — Routing
  main.jsx                — Entry point
```

---

## Roadmap (Phase 3+)

- **Microsoft sign-in** (MSAL) — replaces email/password once Azure AD is configured
- **Email open tracking** — Cloudflare Worker pixel for open detection
- **Reminder emails** — scheduled follow-up sends to non-responders
- **Event duplication** — clone a previous event's setup as a starting point
- **Export to CSV/Excel** — full RSVP list for any event
- **Co-host permissions** — per-event access control by staff member
