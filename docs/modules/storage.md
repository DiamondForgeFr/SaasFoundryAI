# Storage Module (S3)

File upload and storage with S3-compatible object storage.

## Overview

The storage module provides a complete solution for handling file uploads in your SaaS application:

- ✅ **S3-Compatible**: Works with AWS S3, MinIO, Backblaze B2, DigitalOcean Spaces
- ✅ **Organization-Scoped**: Files are isolated per organization
- ✅ **Secure URLs**: Pre-signed URLs for temporary access
- ✅ **Type Safety**: TypeScript interfaces for all operations
- ✅ **Frontend Integration**: Ready-to-use upload components

## Features

### Backend (API)
- File upload endpoint with multipart/form-data
- Automatic organization-based folder structure
- Pre-signed URL generation for downloads
- File deletion with permission checks
- Support for multiple storage providers

### Frontend (Web)
- File upload UI components
- Progress tracking
- Drag-and-drop support (via ShadCN components)
- Automatic S3 integration

## Setup Options

You can configure storage during project creation (`sf new`) or add it later (`sf update`).

### Option 1: Docker (MinIO) - Development

**Best for**: Local development, testing

```bash
sf new  # or sf update
# Select: "Yes, add MinIO with Docker"
```

**What you get**:
- MinIO running in Docker (S3-compatible)
- Automatic configuration
- No cost, runs locally
- Console UI at http://localhost:9001

**Configuration**:
```env
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_BUCKET="myapp-uploads"
S3_PUBLIC_URL="http://localhost:9000/myapp-uploads"
```

### Option 2: AWS S3 - Production

**Best for**: Production deployments

```bash
sf new  # or sf update
# Select: "Yes, connect to my existing S3-compatible server"
# Choose: AWS S3
```

**Prerequisites**:
1. AWS account
2. S3 bucket created
3. IAM user with S3 permissions

**Permissions needed**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

**Configuration**:
```env
S3_ENDPOINT="s3.amazonaws.com"  # or s3.us-east-1.amazonaws.com
S3_REGION="us-east-1"           # Your bucket region
S3_ACCESS_KEY_ID="AKIAXXXXXXXX"
S3_SECRET_ACCESS_KEY="your-secret-key"
S3_BUCKET="your-bucket-name"
S3_PUBLIC_URL="https://your-bucket-name.s3.amazonaws.com"
```

### Option 3: Other S3-Compatible Providers

**Supported**:
- Backblaze B2
- DigitalOcean Spaces
- Cloudflare R2
- Wasabi
- Any S3-compatible storage

**Example (DigitalOcean Spaces)**:
```env
S3_ENDPOINT="nyc3.digitaloceanspaces.com"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="your-spaces-key"
S3_SECRET_ACCESS_KEY="your-spaces-secret"
S3_BUCKET="your-space-name"
S3_PUBLIC_URL="https://your-space-name.nyc3.digitaloceanspaces.com"
```

## Installation

### During Project Creation

```bash
sf new
# When prompted:
? Do you want to set up object storage (S3)?
→ Yes, add MinIO with Docker  # or connect to existing
```

### Add to Existing Project

```bash
sf update
# Select: "Storage (S3)"
# Choose setup option: Docker / Credentials / Manual
```

The installer will:
1. Copy storage module to `apps/api/src/modules/storage/`
2. Add S3 environment variables to `.env`
3. Install `@aws-sdk/client-s3` dependency
4. Register StorageModule in `app.module.ts`
5. Enable storage in frontend `.env`

## Usage

### API Endpoints

The storage module adds these endpoints:

#### Upload File

```http
POST /api/storage/upload
Content-Type: multipart/form-data
Authorization: Bearer {token}

file: [binary data]
```

**Response**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "key": "org-123/logo.png",
  "bucket": "myapp-uploads",
  "url": "https://myapp-uploads.s3.amazonaws.com/org-123/logo.png",
  "publicUrl": "https://myapp-uploads.s3.amazonaws.com/org-123/logo.png"
}
```

#### Get Download URL

```http
GET /api/storage/:id/download
Authorization: Bearer {token}
```

**Response**:
```json
{
  "url": "https://myapp-uploads.s3.amazonaws.com/org-123/logo.png?X-Amz-Signature=..."
}
```

Pre-signed URL valid for 1 hour.

#### Delete File

```http
DELETE /api/storage/:id
Authorization: Bearer {token}
```

### Backend Integration

```typescript
import { StorageService } from '@modules/storage/services/storage.service'

@Injectable()
export class OrganizationService {
  constructor(private readonly storageService: StorageService) {}

  async uploadLogo(user: User, file: Express.Multer.File) {
    // Upload file to S3
    const result = await this.storageService.uploadFile(file, user.organizationId)

    // Save URL to database
    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { logoUrl: result.publicUrl }
    })

    return result
  }

  async deleteLogo(user: User) {
    const org = await this.prisma.organization.findUnique({
      where: { id: user.organizationId }
    })

    if (org.logoUrl) {
      // Extract key from URL
      const key = org.logoUrl.split('/').slice(-2).join('/')
      await this.storageService.deleteFile(key, user.organizationId)
    }

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { logoUrl: null }
    })
  }
}
```

### Frontend Integration

The generated frontend includes upload support in the organization settings.

**Example** (`apps/web/src/pages/private/OrganizationSettings.tsx`):

```typescript
import { useState } from 'react'
import { useUpdateOrganization } from '@/hooks/api/useOrganization'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function OrganizationSettings() {
  const [file, setFile] = useState<File | null>(null)
  const updateOrganization = useUpdateOrganization()

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    // Upload via API
    const response = await fetch('http://localhost:3000/api/storage/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`
      },
      body: formData
    })

    const { publicUrl } = await response.json()

    // Update organization with new logo URL
    updateOrganization.mutate({ logoUrl: publicUrl })
  }

  return (
    <form onSubmit={handleUpload}>
      <Input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
      <Button type="submit" disabled={!file}>
        Upload Logo
      </Button>
    </form>
  )
}
```

## File Organization

Files are automatically organized by organization:

```
your-bucket/
├── org-abc123/
│   ├── logo.png
│   ├── documents/
│   │   ├── contract.pdf
│   │   └── invoice.pdf
│   └── avatars/
│       ├── user-1.jpg
│       └── user-2.jpg
├── org-def456/
│   ├── logo.png
│   └── ...
```

**Key Format**: `{organizationId}/{filename}`

This ensures:
- ✅ Isolation between organizations
- ✅ Easy cleanup when deleting an organization
- ✅ Clear ownership of files

## Security

### Access Control

- **Upload**: Requires authentication (JWT)
- **Download**: Requires authentication + organization membership
- **Delete**: Requires authentication + organization membership

### File Validation

The module validates:
- File size (configurable, default 10MB)
- File type (configurable)
- Organization ownership

Example validation:

```typescript
// apps/api/src/modules/storage/storage.controller.ts
@Post('upload')
@UseGuards(JwtAuthGuard)
@UseInterceptors(FileInterceptor('file', {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.match(/\/(jpg|jpeg|png|pdf)$/)) {
      return cb(new Error('Only images and PDFs allowed'), false)
    }
    cb(null, true)
  }
}))
async uploadFile(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File) {
  return this.storageService.uploadFile(file, user.organizationId)
}
```

## Configuration

### Environment Variables

**Required**:
```env
S3_ENDPOINT="s3.amazonaws.com"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="your-access-key"
S3_SECRET_ACCESS_KEY="your-secret-key"
S3_BUCKET="your-bucket"
S3_PUBLIC_URL="https://your-bucket.s3.amazonaws.com"
```

**Optional**:
```env
S3_MAX_FILE_SIZE="10485760"  # 10MB in bytes
S3_ALLOWED_MIME_TYPES="image/jpeg,image/png,application/pdf"
```

### Frontend Configuration

Enable storage in `apps/web/.env`:

```env
VITE_STORAGE_ENABLED="true"
```

## Development with MinIO

### Start MinIO

```bash
docker compose -f docker-compose.dev-services.yml up -d
```

### Access Console

- **URL**: http://localhost:9001
- **User**: minioadmin
- **Password**: minioadmin

### Create Bucket

MinIO console:
1. Click "Buckets" → "Create Bucket"
2. Name: `myapp-uploads` (match S3_BUCKET in .env)
3. Click "Create"

### Test Upload

```bash
curl -X POST http://localhost:3000/api/storage/upload \
  -H "Authorization: Bearer {your-jwt-token}" \
  -F "file=@/path/to/file.png"
```

## Production Deployment

### AWS S3 Setup

1. **Create Bucket**:
   ```bash
   aws s3 mb s3://myapp-uploads --region us-east-1
   ```

2. **Create IAM User**:
   ```bash
   aws iam create-user --user-name myapp-s3-user
   ```

3. **Attach Policy**:
   ```bash
   aws iam put-user-policy --user-name myapp-s3-user \
     --policy-name S3Access \
     --policy-document file://s3-policy.json
   ```

4. **Create Access Keys**:
   ```bash
   aws iam create-access-key --user-name myapp-s3-user
   ```

5. **Set Environment Variables** in production:
   ```env
   S3_ENDPOINT="s3.amazonaws.com"
   S3_REGION="us-east-1"
   S3_ACCESS_KEY_ID="AKIAXXXXXXXX"
   S3_SECRET_ACCESS_KEY="your-secret"
   S3_BUCKET="myapp-uploads"
   S3_PUBLIC_URL="https://myapp-uploads.s3.amazonaws.com"
   ```

### CDN (Optional)

For better performance, use CloudFront:

1. Create CloudFront distribution
2. Set S3 bucket as origin
3. Update `S3_PUBLIC_URL`:
   ```env
   S3_PUBLIC_URL="https://d123456.cloudfront.net"
   ```

## Troubleshooting

### Upload Fails: "Invalid Credentials"

**Check**:
- S3_ACCESS_KEY_ID is correct
- S3_SECRET_ACCESS_KEY is correct
- IAM user has correct permissions

### Upload Fails: "Bucket does not exist"

**Solution**:
- Verify S3_BUCKET matches actual bucket name
- For MinIO: Create bucket in console first

### Files Not Accessible

**Check**:
- Bucket permissions (public vs private)
- S3_PUBLIC_URL is correct
- CORS configuration if accessing from browser

**MinIO CORS** (for local dev):
```bash
mc alias set myminio http://localhost:9000 minioadmin minioadmin
mc anonymous set download myminio/myapp-uploads
```

### Large File Upload Fails

**Increase limits**:

API (`apps/api/src/main.ts`):
```typescript
app.use(json({ limit: '50mb' }))
app.use(urlencoded({ extended: true, limit: '50mb' }))
```

Nginx (if using):
```nginx
client_max_body_size 50M;
```

## Next Steps

- [Email Module](/modules/email) - Send emails with uploads
- [Module System](/guide/module-system) - How modules work
- [API Reference](/api/installers) - Storage installer details

## Related Commands

- [`sf new`](/cli/sf-new) - Create project with storage
- [`sf update`](/cli/sf-update) - Add storage to existing project
