# Drive Desk

A Chrome extension that provides quick and convenient access to your Google Drive documents directly from the browser toolbar. Manage your files, create new documents, and access your Drive content with ease.

## Features

### 📁 Document Management
- **View My Drive**: Browse all your Google Drive documents in a clean, organized grid view
- **Recent Activity**: Quick access to your recently viewed or modified files
- **Search**: Powerful search functionality to quickly find documents by name
- **Type Filtering**: Filter documents by type (Google Docs, Sheets, Slides, or Forms)

### ✨ Quick Actions
- **Create New Documents**: Instantly create new Google Docs, Sheets, Slides, or Forms with one click
- **Pin Documents**: Pin frequently used documents for quick access
- **Delete Documents**: Remove unwanted files directly from the extension
- **Quick Open**: Open documents in clean popup windows without browser chrome

### 🔐 Security & Privacy
- **Secure OAuth2 Authentication**: Uses Google's official OAuth2 flow for secure authentication
- **Multi-Account Support**: Switch between multiple Google accounts seamlessly
- **Token Management**: Automatic token refresh ensures uninterrupted access
- **Local Storage**: All data is stored locally in your browser

### 🎨 User Experience
- **Modern UI**: Clean, intuitive interface with smooth animations
- **Infinite Scroll**: Automatically loads more documents as you scroll
- **Responsive Design**: Works perfectly in the extension popup
- **Dark Theme Support**: Comfortable viewing in any lighting condition

## Installation

### From Chrome Web Store (Recommended)

1. Visit the Chrome Web Store page for Drive Desk
2. Click the **"Add to Chrome"** button
3. Review the permissions requested by the extension
4. Click **"Add Extension"** to confirm installation
5. The Drive Desk icon will appear in your browser toolbar

### Manual Installation (For Developers)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **"Developer mode"** (toggle in the top right corner)
4. Click **"Load unpacked"**
5. Select the folder containing the extension files
6. The extension will be installed and ready to use

**Note**: For manual installation, you'll need to:
- Copy `manifest.json.example` to `manifest.json`
- Add your own Google OAuth2 credentials (client_id and client_secret)
- See `manifest.json.example` for the required structure

## Usage

### First Time Setup

1. Click the Drive Desk icon in your browser toolbar
2. Click **"Sign in"** to authenticate with your Google account
3. Grant the necessary permissions when prompted
4. You're ready to use Drive Desk!

### Using the Extension

- **Browse Documents**: Click on "Drive" or "Recent" tabs to view your files
- **Search**: Type in the search box to find specific documents
- **Filter by Type**: Click the filter icon to show only specific document types
- **Create New**: Click the document type icons at the top to create new files
- **Pin Documents**: Click the pin icon on any document to pin it
- **Delete Documents**: Click the delete icon to remove files (with confirmation)
- **Open Documents**: Click on any document card to open it in a new window

## Privacy Policy

### Data Access

Drive Desk requests access to your Google Drive files through Google's OAuth2 API. This access is necessary to:

- Display your documents in the extension
- Search through your files
- Create new documents
- Manage your files (pin, delete)

### Data Usage

**We respect your privacy:**

- ✅ **No Data Collection**: Drive Desk does not collect, store, or transmit your file data to any external servers
- ✅ **No File Publishing**: Your files are never published, shared, or made accessible to anyone else
- ✅ **No Commercial Use**: Your files and data are never used for commercial purposes, advertising, or any other monetization
- ✅ **Local Storage Only**: All data (authentication tokens, preferences) is stored locally in your browser using Chrome's storage API
- ✅ **Secure Authentication**: All authentication is handled through Google's official OAuth2 flow

### Permissions Explained

- **Storage**: Used to save your authentication state and preferences locally
- **Identity**: Required for Google OAuth2 authentication
- **Tabs/Windows**: Used to open documents in new windows
- **Google Drive API**: Required to list, search, and manage your files
- **User Info**: Used to display your profile picture and email

### Your Rights

You have full control over your data:
- You can revoke access at any time through your [Google Account Settings](https://myaccount.google.com/permissions)
- You can uninstall the extension at any time, which will remove all locally stored data
- All file operations are performed directly through Google's API - we never see or store your file contents

## Support & Contact

For questions, bug reports, or feature requests, please contact:

**Telegram**: [@kenig_web](https://t.me/kenig_web)

## Technical Details

### Technologies Used

- **Manifest V3**: Latest Chrome extension manifest format
- **OAuth2**: Google OAuth2 for secure authentication
- **Google Drive API**: For file management and operations
- **Chrome Identity API**: For seamless Google account integration
- **Vanilla JavaScript**: No external dependencies

### Browser Compatibility

- Chrome 88+ (Manifest V3 support required)
- Edge 88+ (Chromium-based)

## Development

### Project Structure

```
google_editor/
├── assets/
│   └── icons/          # Extension icons
├── background.js       # Service worker for window management
├── oauth.js            # OAuth2 authentication logic
├── popup.html          # Extension popup UI
├── popup.js            # Main extension logic
├── popup.css           # Styles
├── manifest.json       # Extension manifest (not in repo)
└── manifest.json.example  # Example manifest template
```

### Setup for Development

1. Copy `manifest.json.example` to `manifest.json`
2. Add your Google OAuth2 credentials to `manifest.json`
3. Load the extension in developer mode
4. Make your changes and test

### Security Note

**Important**: The `manifest.json` file contains sensitive OAuth2 credentials and is excluded from version control via `.gitignore`. Never commit your actual `manifest.json` file to a public repository.

## License

This project is provided as-is for personal and educational use.

## Version

Current version: **0.1.0**

---

**Made with ❤️ for efficient Google Drive management**

