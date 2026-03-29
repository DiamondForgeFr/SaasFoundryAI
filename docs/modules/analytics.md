# Analytics Module (Umami)

Privacy-focused web analytics with Umami.

## Overview

The analytics module integrates Umami analytics into your SaaS application frontend:

- ✅ **Privacy-Focused**: No cookies, GDPR compliant
- ✅ **Lightweight**: Minimal performance impact
- ✅ **Self-Hostable**: Full data ownership
- ✅ **Real-Time**: Live visitor tracking
- ✅ **Simple Integration**: Auto-configured tracking script

## Features

- **Page Views**: Automatic tracking on route changes
- **Custom Events**: Track user actions (button clicks, form submissions)
- **Visitor Analytics**: Unique visitors, sessions, bounce rate
- **Performance**: Fast loading, no impact on user experience
- **Privacy**: No personal data collected, no cookies

## Why Umami?

### vs Google Analytics

| Feature        | Umami               | Google Analytics           |
| -------------- | ------------------- | -------------------------- |
| Privacy        | ✅ GDPR compliant   | ❌ Requires cookie consent |
| Data Ownership | ✅ You own the data | ❌ Google owns the data    |
| Cookies        | ✅ No cookies       | ❌ Uses cookies            |
| Self-Hosted    | ✅ Optional         | ❌ Cloud only              |
| Cost           | ✅ Free             | ✅ Free (with limits)      |
| Complexity     | ✅ Simple           | ⚠️ Complex                 |

### vs Plausible

| Feature       | Umami               | Plausible      |
| ------------- | ------------------- | -------------- |
| Self-Hosted   | ✅ Open source      | ✅ Open source |
| Cloud Pricing | ✅ Free (self-host) | ❌ $9/month+   |
| Features      | ✅ Complete         | ✅ Complete    |
| UI            | ✅ Modern           | ✅ Modern      |

## Setup Options

### Option 1: Self-Hosted (Recommended)

**Best for**: Full control, privacy, no cost

**Requirements**:

- PostgreSQL or MySQL database
- Node.js 18+ server
- Domain name (optional)

**Steps**:

1. **Deploy Umami**:

   ```bash
   # Clone Umami
   git clone https://github.com/umami-software/umami.git
   cd umami

   # Install dependencies
   npm install

   # Create database
   createdb umami

   # Set environment variables
   cp .env.example .env
   # Edit .env:
   DATABASE_URL="postgresql://user:pass@localhost:5432/umami"
   ```

2. **Build and Run**:

   ```bash
   npm run build
   npm start
   ```

3. **Create Website**:

   - Open http://localhost:3000
   - Login (default: admin / umami)
   - Settings → Websites → Add Website
   - Name: `My SaaS App`
   - Domain: `myapp.com`
   - Copy the **Website ID**

4. **Configure SaaSFoundry**:

   ```bash
   sf new  # or sf update
   # Select: "Yes" for analytics
   # Analytics URL: http://localhost:3000/script.js
   # Website ID: [paste from Umami]
   ```

### Option 2: Umami Cloud

**Best for**: Quick setup, no maintenance

**Cost**: Free tier available, then $9/month

**Steps**:

1. **Sign up**: https://umami.is/pricing
2. **Create Website** in dashboard
3. **Get Website ID** from settings
4. **Configure SaaSFoundry**:

   ```bash
   sf new  # or sf update
   # Select: "Yes" for analytics
   # Analytics URL: https://cloud.umami.is/script.js
   # Website ID: [your-website-id]
   ```

### Option 3: Docker (Development)

**Best for**: Local testing

```bash
# docker-compose.yml
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    ports:
      - "3001:3000"
    environment:
      DATABASE_URL: postgresql://umami:umami@db:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: your-secret-key
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: umami
    volumes:
      - umami-db:/var/lib/postgresql/data

volumes:
  umami-db:
```

```bash
docker-compose up -d
# Access: http://localhost:3001
# Create website and get ID
```

## Installation

### During Project Creation

```bash
sf new
# When prompted:
? Do you want to include Umami analytics?
→ Yes

? Enter your Umami analytics URL
→ https://analytics.myapp.com/script.js  # or cloud.umami.is

? Enter your Umami website ID
→ abc123-def456-ghi789
```

### Add to Existing Project

```bash
sf update
# Select: "Analytics (Umami)"
# Enter: Analytics URL and Website ID
```

The installer will:

1. Copy analytics module to `apps/web/src/lib/analytics/`
2. Add VITE*ANALYTICS*\* variables to `.env`
3. Initialize tracking in `main.tsx`

## Usage

### Automatic Tracking

Page views are tracked automatically on route changes.

```typescript
// apps/web/src/main.tsx
import { initAnalytics } from '@/lib/analytics/analytics'

// Analytics initialized here
initAnalytics()

// Every route change is tracked
<RouterProvider router={router} />
```

### Custom Events

Track user actions:

```typescript
import { trackEvent } from '@/lib/analytics/analytics'

// Button click
<Button onClick={() => {
  trackEvent('signup_clicked', { plan: 'pro' })
  // ... signup logic
}}>
  Sign Up
</Button>

// Form submission
const handleSubmit = async (data) => {
  trackEvent('form_submitted', { formName: 'contact' })
  await api.post('/contact', data)
}

// Feature usage
const handleExport = () => {
  trackEvent('data_exported', { format: 'csv', records: 100 })
  exportData()
}
```

### Event Parameters

```typescript
trackEvent('event_name', {
  key1: 'value1',
  key2: 123,
  key3: true
})
```

**Best practices**:

- Use snake_case for event names: `signup_clicked`
- Keep names descriptive: `invite_sent` not `action_1`
- Include context in parameters: `{ plan: 'pro', duration: 'monthly' }`

## Configuration

### Environment Variables

**Frontend** (`apps/web/.env`):

```env
# Umami Analytics
VITE_ANALYTICS_URL="https://analytics.myapp.com/script.js"
VITE_ANALYTICS_WEBSITE_ID="abc123-def456-ghi789"
```

**Self-Hosted** (Umami server `.env`):

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/umami"
APP_SECRET="your-random-secret-key-here"
TRACKER_SCRIPT_NAME="script.js"  # Can rename for privacy
```

### Analytics Library

The generated analytics module (`apps/web/src/lib/analytics/analytics.ts`):

```typescript
// Initialize analytics
export function initAnalytics() {
  if (!import.meta.env.VITE_ANALYTICS_URL || !import.meta.env.VITE_ANALYTICS_WEBSITE_ID) {
    return
  }

  const script = document.createElement('script')
  script.src = import.meta.env.VITE_ANALYTICS_URL
  script.async = true
  script.defer = true
  script.setAttribute('data-website-id', import.meta.env.VITE_ANALYTICS_WEBSITE_ID)
  document.head.appendChild(script)
}

// Track custom events
export function trackEvent(name: string, data?: Record<string, any>) {
  if (typeof window.umami !== 'undefined') {
    window.umami.track(name, data)
  }
}
```

## Viewing Analytics

### Dashboard

Access your Umami dashboard:

- **Self-hosted**: http://your-domain.com
- **Cloud**: https://cloud.umami.is

### Metrics

**Real-Time**:

- Current visitors
- Page views (last 24h)
- Popular pages

**Historical**:

- Total page views
- Unique visitors
- Bounce rate
- Average visit duration
- Pages per visit

**Breakdown**:

- Pages (most visited)
- Referrers (traffic sources)
- Browsers
- Operating Systems
- Devices (desktop, mobile, tablet)
- Countries
- Languages

### Custom Events

View tracked events:

1. Go to your website dashboard
2. Click "Events" tab
3. See event names and counts
4. Filter by date range

**Example events**:

- `signup_clicked` - 245 times
- `invite_sent` - 89 times
- `data_exported` - 34 times

## Privacy & GDPR

### No Cookies

Umami doesn't use cookies, so:

- ✅ No cookie banner needed
- ✅ No cookie consent required
- ✅ GDPR compliant by design

### Data Collected

**Yes**:

- Page URLs
- Referrer
- Browser type
- Operating system
- Device type
- Country (from IP)

**No**:

- Personal information
- IP addresses (hashed and discarded)
- User identification
- Cross-site tracking

### Privacy Policy

Example text for your privacy policy:

```
We use Umami analytics to understand how visitors use our website.
Umami collects anonymous usage data (pages visited, browser type,
country) without using cookies or collecting personal information.
No data is shared with third parties. [Self-hosted: All data is
stored on our own servers.] Learn more: https://umami.is/privacy
```

## Performance

### Script Size

- **Size**: ~2KB gzipped
- **Load Time**: < 50ms
- **Impact**: Minimal

### Best Practices

**Do**:

- ✅ Load script with `async` and `defer`
- ✅ Track meaningful events only
- ✅ Use descriptive event names
- ✅ Keep event data small

**Don't**:

- ❌ Track every user action
- ❌ Send large data objects
- ❌ Block rendering with analytics
- ❌ Track sensitive information

## Advanced Usage

### Custom Domains

For self-hosted, you can use a custom subdomain:

```nginx
# nginx configuration
server {
  listen 80;
  server_name analytics.myapp.com;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### Rename Tracker Script

To avoid ad-blockers, rename the tracker:

**Umami `.env`**:

```env
TRACKER_SCRIPT_NAME="stats.js"  # Instead of script.js
```

**SaaSFoundry `.env`**:

```env
VITE_ANALYTICS_URL="https://analytics.myapp.com/stats.js"
```

### Multi-Site Tracking

Track multiple environments:

```typescript
const websiteId = import.meta.env.PROD ? 'production-website-id' : 'development-website-id'

script.setAttribute('data-website-id', websiteId)
```

### Disable in Development

```typescript
export function initAnalytics() {
  if (import.meta.env.DEV) {
    console.log('Analytics disabled in development')
    return
  }

  // ... initialize analytics
}
```

## Troubleshooting

### Events Not Tracked

**Check**:

1. Analytics script loaded: View page source, search for "umami"
2. Website ID correct: Check `.env` vs Umami dashboard
3. URL accessible: Open `VITE_ANALYTICS_URL` in browser
4. Ad-blocker disabled: Test in incognito mode

**Debug**:

```typescript
export function trackEvent(name: string, data?: Record<string, any>) {
  console.log('Tracking event:', name, data) // Add this

  if (typeof window.umami !== 'undefined') {
    window.umami.track(name, data)
  } else {
    console.warn('Umami not loaded') // Add this
  }
}
```

### Dashboard Shows No Data

**Wait**: Analytics can take 1-2 minutes to appear

**Check**:

- Website is not paused in Umami
- Date range includes today
- You're viewing the correct website

### Self-Hosted Setup Issues

**Database connection**:

```bash
# Test PostgreSQL connection
psql postgresql://user:pass@localhost:5432/umami
```

**Build errors**:

```bash
# Clear and rebuild
rm -rf .next node_modules
npm install
npm run build
```

**Port already in use**:

```bash
# Change port in .env
PORT=3001
```

## Production Deployment

### Recommended Setup

1. **Self-host Umami** on your infrastructure
2. **Use custom domain**: `analytics.myapp.com`
3. **SSL certificate**: Let's Encrypt
4. **Database backups**: Daily automated backups

### Docker Deployment

```yaml
# docker-compose.production.yml
version: '3'
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    restart: always
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://umami:${DB_PASSWORD}@db:5432/umami
      APP_SECRET: ${APP_SECRET}
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - umami-db:/var/lib/postgresql/data
      - ./backups:/backups # For backups

volumes:
  umami-db:
```

### Environment Variables

```env
# Production .env for Umami
DATABASE_URL="postgresql://umami:strong-password@db:5432/umami"
APP_SECRET="generate-with-openssl-rand-base64-32"
TRACKER_SCRIPT_NAME="script.js"
PORT=3000
```

## Next Steps

- [Email Module](/modules/email) - Track email opens
- [Module System](/guide/module-system) - How modules work
- [First Project](/getting-started/first-project) - Complete tutorial

## Related Commands

- [`sf new`](/cli/sf-new) - Create project with analytics
- [`sf update`](/cli/sf-update) - Add analytics to existing project

## Resources

- [Umami Documentation](https://umami.is/docs)
- [Umami GitHub](https://github.com/umami-software/umami)
- [Umami Cloud](https://cloud.umami.is)
