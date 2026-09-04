# Web Push Notifications Setup Guide

This guide explains how to set up and test Web Push Notifications for the BMDC PWA system.

## Overview

The system implements the **Web Push Protocol (RFC 8030)** to send encrypted push notifications to installed PWA devices. This is completely free and uses browser-native APIs.

## Components

1. **Backend (`pushService.ts`)** - Handles sending notifications using web-push library
2. **Database** - Stores device push subscriptions with encryption keys
3. **Frontend (`pushSubscription.ts`)** - Manages subscription lifecycle on client
4. **Service Worker (`sw.js`)** - Displays and handles push notifications

## Setup Steps

### 1. Generate VAPID Keys

VAPID keys identify your server to push services. Generate them once:

```bash
cd Backend
npx web-push generate-vapid-keys
```

Output will look like:
```
Public Key: BCxxxxx...
Private Key: yyyyyzzz...
```

### 2. Add Keys to Environment

Update `Backend/.env`:

```env
VAPID_PUBLIC_KEY=<public-key-from-above>
VAPID_PRIVATE_KEY=<private-key-from-above>
```

**Security Note:** Never commit `.env` to version control. Use environment secrets in CI/CD.

### 3. Install Dependencies

```bash
cd Backend
npm install
```

This installs:
- `web-push@^3.6.7` - Sends notifications
- `@types/web-push@^3.6.3` - TypeScript types

### 4. Run Database Migration

Apply the migration to create push_subscriptions table:

```bash
# In your Supabase dashboard or via CLI:
# Run the SQL from: Backend/migrations/016_add_push_subscriptions.sql
```

This creates:
- `push_subscriptions` table with subscription storage
- Indexes for performance
- RLS policies for security

### 5. Verify Service Worker

The service worker (`Frontend/src/public/sw.js`) already includes push event handlers:

```javascript
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  // Shows notification to user
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});
```

## Testing Push Notifications

### Test 1: Verify VAPID Keys

```bash
# Backend should log successfully during startup
curl http://localhost:3003/api/push-subscriptions/vapid

# Should return:
# { "data": { "vapidKey": "BCxxxxx..." }, ... }
```

### Test 2: Subscribe to Push

On the frontend:

1. Go to Settings page
2. Toggle "Push Notifications" ON
3. Browser prompts for permission
4. Grant permission
5. Check backend logs:
   ```
   [PUSH] Device subscribed to push notifications {
     subscriptionId: 'uuid',
     endpoint: 'https://fcm.googleapis.com/fcm/send/...'
   }
   ```

### Test 3: Send Manual Notification

Use the backend API:

```bash
# Get your subscription ID from logs above
SUBSCRIPTION_ID="<from-logs>"

# Trigger enrollment notification
curl -X POST http://localhost:3003/api/notifications \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-auth-token>" \
  -d '{
    "type": "enrollment_confirmation",
    "trainee_id": "trainee-uuid",
    "program_name": "Advanced Training",
    "start_date": "2024-02-15"
  }'

# Should send:
# - WhatsApp message (if configured)
# - Email
# - Push notification to all active subscriptions
```

### Test 4: View in Service Worker

Open browser DevTools:

1. Go to **Application** tab
2. Click **Service Workers**
3. Check "Show all" to see registered SW
4. You should see `/sw.js` listed
5. Check **Manifest** tab to see app manifest

### Test 5: Check Subscriptions

On the frontend, get all subscriptions:

```javascript
import { getUserPushSubscriptions } from './utils/pushSubscription';

const subscriptions = await getUserPushSubscriptions();
console.log('Active subscriptions:', subscriptions);
// Output:
// [
//   {
//     id: 'uuid',
//     endpoint: 'https://fcm.googleapis.com/...',
//     deviceIdentifier: 'chrome-windows-desktop',
//     isActive: true,
//     createdAt: '2024-01-15T10:00:00Z'
//   }
// ]
```

## API Endpoints

### GET /api/push-subscriptions/vapid

Returns VAPID public key (public, no auth required).

**Response:**
```json
{
  "data": {
    "vapidKey": "BCxxxxx..."
  },
  "message": "VAPID public key retrieved"
}
```

### POST /api/push-subscriptions

Register device push subscription (auth required).

**Request:**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "auth": "base64-auth-secret",
    "p256dh": "base64-p256dh-key"
  },
  "deviceIdentifier": "chrome-windows-desktop",
  "userAgent": "Mozilla/5.0..."
}
```

**Response:**
```json
{
  "data": {
    "id": "subscription-uuid",
    "endpoint": "...",
    "is_active": true,
    "created_at": "2024-01-15T10:00:00Z"
  },
  "message": "Push subscription registered"
}
```

### GET /api/push-subscriptions

Get user's subscriptions (auth required).

**Response:**
```json
{
  "data": [
    {
      "id": "subscription-uuid",
      "endpoint": "https://fcm.googleapis.com/...",
      "device_identifier": "chrome-windows-desktop",
      "is_active": true,
      "last_used_at": "2024-01-15T11:00:00Z",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

### DELETE /api/push-subscriptions/{id}

Unsubscribe device (auth required).

**Response:**
```json
{
  "data": { "id": "subscription-uuid" },
  "message": "Push subscription unregistered"
}
```

## Notification Types

Push notifications are sent for:

1. **Enrollment Confirmation** - When trainee enrolled in program
2. **Schedule Change** - When program schedule updates
3. **Training Reminder** - 24h before training starts
4. **Training Completion** - When trainee completes program

Each respects user's notification preferences in `notification_preferences` column on trainees table.

## User Preferences

Trainees can opt out via `notification_preferences` JSONB column:

```json
{
  "optOutAll": false,
  "optOutEnrollment": false,
  "optOutScheduleChange": true,
  "optOutReminders": false,
  "optOutCompletion": false
}
```

## Troubleshooting

### No notifications received

**Check 1:** Is service worker registered?
```javascript
navigator.serviceWorker.ready.then(reg => {
  console.log('SW active:', reg.active !== null);
});
```

**Check 2:** Is notification permission granted?
```javascript
console.log('Permission:', Notification.permission);
// Should be 'granted'
```

**Check 3:** Are subscriptions active?
```bash
# Check database
SELECT * FROM push_subscriptions WHERE is_active = true;
```

**Check 4:** Are VAPID keys configured?
```bash
echo $VAPID_PUBLIC_KEY
echo $VAPID_PRIVATE_KEY
# Both should be set
```

### "410 Gone" errors

Subscriptions become invalid if:
- User uninstalled app/PWA
- Browser cleared site data
- Subscription endpoint expired (rare)

The system automatically marks these as inactive and cleans them up after 7 days.

### VAPID key errors

If you see "Invalid VAPID credentials":

1. Regenerate keys: `npx web-push generate-vapid-keys`
2. Update `.env` with new keys
3. Restart backend: `npm run dev`
4. Clear browser cache and resubscribe

## Production Deployment

### Security Checklist

- [ ] VAPID keys stored in environment secrets (not in code)
- [ ] Only HTTPS endpoints accepted
- [ ] Rate limiting on subscription endpoints
- [ ] Subscription cleanup runs daily (implemented)
- [ ] Encryption keys rotated periodically
- [ ] Audit logging enabled for subscriptions
- [ ] RLS policies enforced in Supabase

### Performance Optimization

- Subscriptions indexed on (user_id, tenant_id, is_active)
- Batch delivery sends to multiple devices in parallel
- Automatic cleanup prevents table bloat
- Retry logic with exponential backoff for transient failures

## Monitoring

### Key Metrics

Monitor these to detect issues:

```sql
-- Active subscriptions per tenant
SELECT tenant_id, COUNT(*) FROM push_subscriptions 
WHERE is_active = true 
GROUP BY tenant_id;

-- Failed deliveries (marked inactive)
SELECT COUNT(*) FROM push_subscriptions 
WHERE is_active = false 
AND updated_at > NOW() - INTERVAL '24 hours';

-- Subscriptions by device
SELECT device_identifier, COUNT(*) FROM push_subscriptions 
WHERE is_active = true 
GROUP BY device_identifier;
```

## References

- [Web Push Protocol (RFC 8030)](https://tools.ietf.org/html/draft-thomson-webpush-http2-00)
- [web-push NPM](https://www.npmjs.com/package/web-push)
- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

## Support

For issues or questions:

1. Check browser console (F12) for errors
2. Check backend logs for push-related messages
3. Verify VAPID keys are set
4. Test with provided test suite: `npm run test`
