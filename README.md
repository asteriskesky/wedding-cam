# The Collective Memory ✨

Think back to the last big event you went to. You probably took a few photos, maybe a video of a speech, or a candid laugh between friends. Now, where are those photos? Buried in your camera roll, or maybe lost in an over-saturated group chat. 

I built **The Collective Memory** because I wanted to change that. I wanted a space where everyone’s perspective—from the high-res gallery shots to the 2 AM dance floor candids—could live together in real-time. It's more than just a gallery; it’s a living archive of the moments that actually matter.

![License](https://img.shields.io/badge/license-MIT-gold)
![Status](https://img.shields.io/badge/status-In--the--Works-orange)
![PWA](https://img.shields.io/badge/PWA-Ready-success)

---

## ✦ The Story
This project started with a simple question: *What if we could see the whole celebration through everyone’s eyes at once?* 

I wanted to build something that felt warm and inviting, but also invisible. No app stores to navigate, no complicated sign-up forms—just a simple, elegant way to share the love. I focused on smooth animations and a layout that lets the photos speak for themselves. From the first toast to the final farewell, every click is saved instantly so you have a shared digital album by the time the night is over.

## ✨ How it works (for you and your guests)
- **It’s just there**: Guests scan a QR code, "install" it to their home screen in two taps, and they’re in. No friction, no barriers.
- **Smart enough to keep up**: The app automatically handles different phases of the event based on the date, keeping everything organized so you don't have to.
- **Real-time snapshots**: As soon as someone hits "upload," the photo is there for everyone to see. It’s a live, private feed of your favorite people.
- **Handling the heavy stuff**: If a video is massive, the app doesn't just give up. It intelligently routes it through Cloudinary or guides the guest to share a Drive/iCloud link so the memory isn't lost.

---

## 🏗 What I'm working on
Right now, this is a custom labor of love, but I’m currently building it into something anyone can use for their own big moments.

**Coming soon to the engine:**
- **The Admin Hub**: A dedicated dashboard to curate the gallery, manage who’s uploading, and export the best shots for your permanent archives.
- **Personalization for Everyone**: I'm building real UI controls so you can swap event names, dates, and themes from a simple settings menu—no code required.
- **Smarter Gallery Features**: Working on better ways to interact with the photos and making the experience even snappier on every device.

---

## 🛠 The Tech (In case you're curious)
I kept things light and fast so it works on any phone, anywhere:
- **Frontend**: Vanilla HTML5, CSS3, and JavaScript. Simple, fast, and effective.
- **Processing**: [Cloudinary](https://cloudinary.com/) handles all the heavy image and video optimization.
- **Real-time**: [Firebase Firestore](https://firebase.google.com/) keeps everything in sync instantly.
- **Access**: [Firebase Anonymous Auth](https://firebase.google.com/) keeps things private but accessible without a login wall.

### 🚀 Quick Setup
If you're a dev and want to take it for a spin:
1.  **Prerequisites**: Set up a Firebase project and a Cloudinary account.
2.  **Config**: Drop your API keys into the `CONFIG` object in `app.js`.
3.  **Deploy**: It’s optimized for [Vercel](https://vercel.com/)—just run `npx vercel --prod`.

---

## 📂 Inside the Box
- `index.html` — The minimalist, story-focused interface.
- `app.js` — The logic handling the camera, Firebase, and uploads.
- `style.css` — Custom animations and design system.
- `sw.js` — Service Worker for that offline-ready, snappy feeling.

---

## 📜 License
MIT License. It's yours to use, tweak, and share.

*Built with ❤️ for every shared memory.*
