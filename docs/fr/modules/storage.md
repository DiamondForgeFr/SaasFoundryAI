# Module Storage — S3

Téléversement et stockage de fichiers dans un service compatible S3.

## Vue d'ensemble

- ✅ AWS S3, MinIO, Backblaze B2, DigitalOcean Spaces, Cloudflare R2 ou autre service compatible ;
- ✅ isolation des clés par organisation ;
- ✅ URL présignées pour les accès temporaires ;
- ✅ interfaces TypeScript ;
- ✅ composants et intégration frontend prêts à l'emploi.

### API

Le backend fournit un endpoint multipart, une arborescence par organisation, des URL de téléchargement, la suppression avec contrôle des permissions et une abstraction du fournisseur.

### Web

Le frontend dispose du choix de fichier, du suivi de progression, du glisser-déposer via les composants ShadCN et de la connexion à l'API.

## Options de configuration

### 1. MinIO avec Docker — développement

```bash
sf new # ou sf update
# Choisir « add MinIO with Docker »
```

```env
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_BUCKET="myapp-uploads"
S3_PUBLIC_URL="http://localhost:9000/myapp-uploads"
```

MinIO tourne localement et expose sa console sur `http://localhost:9001`.

### 2. AWS S3 — production

Créez un bucket et un utilisateur IAM limité aux actions nécessaires :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::your-bucket-name", "arn:aws:s3:::your-bucket-name/*"]
    }
  ]
}
```

```env
S3_ENDPOINT="s3.amazonaws.com"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="AKIAXXXXXXXX"
S3_SECRET_ACCESS_KEY="your-secret-key"
S3_BUCKET="your-bucket-name"
S3_PUBLIC_URL="https://your-bucket-name.s3.amazonaws.com"
```

### 3. Autres fournisseurs S3

Adaptez l'endpoint, la région et l'URL publique. Exemple DigitalOcean Spaces :

```env
S3_ENDPOINT="nyc3.digitaloceanspaces.com"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="your-spaces-key"
S3_SECRET_ACCESS_KEY="your-spaces-secret"
S3_BUCKET="your-space-name"
S3_PUBLIC_URL="https://your-space-name.nyc3.digitaloceanspaces.com"
```

## Installation

```bash
sf new
# Activer Object storage (S3), puis choisir MinIO ou un service existant.

sf update
# Choisir Storage (S3), puis Docker / Credentials / Manual.
```

L'installateur copie le module dans `apps/api/src/modules/storage/`, configure l'environnement, installe `@aws-sdk/client-s3`, enregistre `StorageModule` et active la capacité côté web.

## API

### Téléverser

```http
POST /api/storage/upload
Content-Type: multipart/form-data
Authorization: Bearer {token}

file: [binary data]
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "key": "org-123/logo.png",
  "bucket": "myapp-uploads",
  "url": "https://myapp-uploads.s3.amazonaws.com/org-123/logo.png",
  "publicUrl": "https://myapp-uploads.s3.amazonaws.com/org-123/logo.png"
}
```

### Obtenir une URL de téléchargement

```http
GET /api/storage/:id/download
Authorization: Bearer {token}
```

```json
{
  "url": "https://myapp-uploads.s3.amazonaws.com/org-123/logo.png?X-Amz-Signature=..."
}
```

L'URL présignée reste valable une heure.

### Supprimer

```http
DELETE /api/storage/:id
Authorization: Bearer {token}
```

## Intégration backend

```typescript
import { StorageService } from '@modules/storage/services/storage.service'

@Injectable()
export class OrganizationService {
  constructor(private readonly storageService: StorageService) {}

  async uploadLogo(user: User, file: Express.Multer.File) {
    const result = await this.storageService.uploadFile(file, user.organizationId)

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { logoUrl: result.publicUrl }
    })

    return result
  }
}
```

Passez toujours l'identifiant de l'organisation contrôlée par l'authentification ; ne faites pas confiance à une organisation fournie par le client.

## Intégration frontend

```typescript
const formData = new FormData()
formData.append('file', file)

const response = await fetch('/api/storage/upload', {
  method: 'POST',
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  body: formData
})

const { publicUrl } = await response.json()
updateOrganization.mutate({ logoUrl: publicUrl })
```

Le formulaire généré peut combiner `Input type="file"`, validation client et bouton désactivé tant qu'aucun fichier n'est choisi.

## Organisation des fichiers

```text
your-bucket/
├── org-abc123/
│   ├── logo.png
│   ├── documents/contract.pdf
│   └── avatars/user-1.jpg
└── org-def456/
    └── logo.png
```

Format de clé : `{organizationId}/{filename}`. Cela sépare les tenants, simplifie le nettoyage d'une organisation et rend l'appartenance lisible.

## Sécurité

- **Upload** : JWT obligatoire.
- **Téléchargement** : authentification et appartenance à l'organisation.
- **Suppression** : authentification et appartenance à l'organisation.
- **Validation** : taille, type MIME et propriétaire contrôlés côté serveur.

```typescript
@Post('upload')
@UseGuards(JwtAuthGuard)
@UseInterceptors(
  FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|pdf)$/)) {
        return cb(new Error('Only images and PDFs allowed'), false)
      }
      cb(null, true)
    }
  })
)
async uploadFile(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File) {
  return this.storageService.uploadFile(file, user.organizationId)
}
```

Le type MIME déclaré par le client ne suffit pas pour un usage sensible : ajoutez une inspection du contenu si votre menace l'exige.

## Variables d'environnement

```env
S3_ENDPOINT="s3.amazonaws.com"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="your-access-key"
S3_SECRET_ACCESS_KEY="your-secret-key"
S3_BUCKET="your-bucket"
S3_PUBLIC_URL="https://your-bucket.s3.amazonaws.com"

S3_MAX_FILE_SIZE="10485760"
S3_ALLOWED_MIME_TYPES="image/jpeg,image/png,application/pdf"
```

Activez le frontend :

```env
VITE_STORAGE_ENABLED="true"
```

## Développement avec MinIO

```bash
docker compose -f docker-compose.dev-services.yml up -d
```

- console : `http://localhost:9001` ;
- identifiant et mot de passe par défaut : `minioadmin` ;
- bucket : créez `myapp-uploads`, identique à `S3_BUCKET`.

Test :

```bash
curl -X POST http://localhost:3000/api/storage/upload \
  -H "Authorization: Bearer {your-jwt-token}" \
  -F "file=@/path/to/file.png"
```

## Production AWS

```bash
aws s3 mb s3://myapp-uploads --region us-east-1
aws iam create-user --user-name myapp-s3-user
aws iam put-user-policy --user-name myapp-s3-user \
  --policy-name S3Access \
  --policy-document file://s3-policy.json
aws iam create-access-key --user-name myapp-s3-user
```

Stockez les clés comme secrets de déploiement. Pour un CDN CloudFront, placez le bucket en origine et remplacez `S3_PUBLIC_URL` par le domaine de la distribution.

## Dépannage

### `Invalid Credentials`

Vérifiez l'identifiant, le secret et les permissions IAM exactes.

### `Bucket does not exist`

Comparez `S3_BUCKET` au nom réel. Avec MinIO, créez d'abord le bucket dans la console.

### Fichiers inaccessibles

Vérifiez la politique publique/privée, `S3_PUBLIC_URL` et CORS. En développement MinIO :

```bash
mc alias set myminio http://localhost:9000 minioadmin minioadmin
mc anonymous set download myminio/myapp-uploads
```

### Gros fichier refusé

Alignez les limites du contrôleur, de NestJS et du reverse proxy :

```nginx
client_max_body_size 50M;
```

Augmenter la limite ne remplace ni la validation ni une stratégie multipart pour de très gros objets.

## Étapes suivantes

- [Module Email](/fr/modules/email)
- [Système de modules](/fr/guide/module-system)

## Commandes associées

- [`sf new`](/fr/cli/sf-new)
- [`sf update`](/fr/cli/sf-update)
