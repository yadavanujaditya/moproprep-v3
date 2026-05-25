# Firebase Admin SDK Setup for Server-Side Pro Status Updates

## The Problem
After payment verification, the server needs to update Firestore to set `isPro: true` for the user. This requires Firebase Admin SDK credentials.

## Solution: Generate Service Account Key

1. Go to [Firebase Console](https://console.firebase.google.com/project/haryanamopro/settings/serviceaccounts/adminsdk)
2. Click on "Project Settings" (gear icon) → "Service accounts"
3. Click "Generate new private key"
4. Download the JSON file
5. Rename it to `serviceAccountKey.json`
6. Place it in the root of your project (`d:\MoProPrep\MPP2\serviceAccountKey.json`)

## Alternative: Environment Variables (for Production/Vercel)

If deploying to Vercel or similar, add these environment variables:

```
FIREBASE_PROJECT_ID=haryanamopro
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@haryanamopro.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

## Security Notes

- **NEVER commit `serviceAccountKey.json` to Git!**
- Add it to `.gitignore`
- For production, use environment variables instead

## Verification

After setup, restart the server. You should see:
```
Firebase Admin initialized with service account.
```

Or if using env variables:
```
Firebase Admin initialized with environment variables.
```
