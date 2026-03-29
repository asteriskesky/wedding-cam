# ZR — The Collective Memory ✨

A premium, event-focused Wedding Photo Sharing PWA (Progressive Web App) designed for **Zawa & Rayyan's** special journey. This application allows guests to capture, share, and relive wedding moments in real-time.

![License](https://img.shields.io/badge/license-MIT-gold)
![Status](https://img.shields.io/badge/status-Production--Ready-blue)
![PWA](https://img.shields.io/badge/PWA-Enabled-success)

---

## ✦ The Vision
"The Collective Memory" is more than just a gallery; it's a shared digital album seen through the eyes of every guest. From the vintage vibes of the **Retro** night to the vibrant **Mehendi** and the sacred **Nikah**, every click is preserved instantly for the couple.

## ✨ Key Features
- **Zero-Install Experience**: Built as a PWA, guests can "install" it directly to their home screen for a native feel.
- **Smart Event Switching**: Automatically detects the current wedding event (Retro, Mehendi, or Nikah) based on the date.
- **Dual-Mode Camera**: Capture live within the app or upload high-res memories from the gallery.
- **Large File Support**: Intelligent handling of oversized videos via Cloudinary and Google Drive/iCloud integration.
- **Real-time Synchronization**: Powered by Firebase Firestore for an instant, live gallery experience.
- **Premium Aesthetics**: Minimalist, gold-accented design using **Cormorant Garamond** and **Inter** typography.

## 🛠 Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+)
- **Storage**: [Cloudinary](https://cloudinary.com/) (High-performance image & video delivery)
- **Database**: [Firebase Firestore](https://firebase.google.com/) (Real-time metadata)
- **Auth**: [Firebase Anonymous Auth](https://firebase.google.com/docs/auth) (Seamless guest entry)
- **Deployment**: [Vercel](https://vercel.com/)

---

## 🚀 Quick Setup

### 1. Prerequisites
- A Firebase project ([Firebase Console](https://console.firebase.google.com/))
- A Cloudinary account ([Cloudinary Dashboard](https://cloudinary.com/))

### 2. Configuration
Open `app.js` and update the `CONFIG` object with your credentials:

```javascript
const CONFIG = {
  cloudinary: {
    cloudName: 'your-cloud-name',
    uploadPreset: 'your-preset',
  },
  firebase: {
    apiKey: 'your-api-key',
    authDomain: 'your-project-id.firebaseapp.com',
    projectId: 'your-project-id',
    // ... rest of your config
  }
};
```

### 3. Deploy to Vercel
The project includes a `vercel.json` optimized for PWA support.

```bash
# Using Vercel CLI
npx vercel --prod
```

## 📂 Project Structure
- `index.html` - The core application interface.
- `app.js` - Logic for camera, uploads, and Firebase integration.
- `style.css` - Custom-crafted design system and animations.
- `sw.js` - Service Worker for offline capabilities and caching.
- `manifest.json` - PWA manifest for home-screen installation.

---

## 📜 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

*Created with ❤️ for Zawa & Rayyan.*
