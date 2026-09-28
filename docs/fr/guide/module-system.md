# Système de modules

Le système de modules de SaaSFoundryAI permet d’ajouter des fonctionnalités pendant ou après la création d’un projet.

## Vue d’ensemble

Les modules sont des fonctionnalités optionnelles :

- 📧 **E-mail** — intégration MailerSend pour les e-mails transactionnels ;
- 📦 **Stockage** — stockage compatible S3 pour les téléversements ;
- 📊 **Analytics** — analytics Umami pour le suivi d’usage.

## Ajouter des modules

### Pendant la création

```bash
sf new
# Interactive prompts include module selection
? Email service: MailerSend
? S3 storage: Docker (local development)
? Analytics: Yes, include Umami
```

### Après la création

```bash
cd my-project
sf update
# Select modules to add
? Which modules to add:
  ❯ ◯ Email (MailerSend)
    ◯ Storage (S3)
    ◯ Analytics (Umami)
```

## Modules disponibles

### Module e-mail

**Fournisseur :** MailerSend · **Portée :** API uniquement

- e-mails transactionnels : bienvenue, réinitialisation du mot de passe et invitations ;
- prise en charge des modèles ;
- configuration de plusieurs expéditeurs ;
- mode de test pour le développement.

```bash
sf update
# Select "Email (MailerSend)"
# Configure API key and sender email
```

Voir le [guide du module e-mail](/fr/modules/email).

### Module de stockage

**Fournisseur :** compatible S3, notamment AWS S3 et MinIO · **Portée :** API et Web

- téléversement de fichiers, images et documents ;
- URL présignées pour un accès sécurisé ;
- buckets isolés par organisation ;
- environnement Docker local pour le développement.

```bash
sf update
# Select "Storage (S3)"
# Choose: Manual, Docker, or Credentials
```

### Module d’analytics

**Fournisseur :** Umami · **Portée :** Web uniquement

- analytics respectueux de la vie privée ;
- aucun cookie obligatoire ;
- conçu pour limiter la collecte et faciliter une configuration respectueuse du RGPD ;
- auto-hébergeable.

```bash
sf update
# Select "Analytics (Umami)"
# Configure website ID and URL
```

## Fonctionnement des modules

### Modèle blueprint + overlay

SaaSFoundryAI utilise deux couches :

1. les **blueprints**, modèles de base contenant des marqueurs `TODO` ;
2. les **overlays**, code source du module qui active ces marqueurs.

Blueprint avant l’ajout du module :

```typescript
// TODO mailer-service-active: import { EmailService } from './email.service'

export class AuthService {
  // TODO mailer-service-active: constructor(private emailService: EmailService) {}
}
```

Après installation du module e-mail :

```typescript
import { EmailService } from './email.service'

export class AuthService {
  constructor(private emailService: EmailService) {}
}
```

### Processus d’installation

Lors de l’ajout d’un module, l’installateur :

1. copie les fichiers de l’overlay ;
2. active les marqueurs `TODO` ;
3. ajoute les dépendances npm ;
4. met à jour les fichiers `.env` ;
5. enregistre le module dans `.saasfoundry.json`.

### Suivi dans le manifeste

```json
{
  "modules": {
    "email": { "provider": "mailersend", "version": 1 },
    "s3Setup": "docker",
    "includeAnalytics": true
  }
}
```

## Mise à jour des modules

SaaSFoundryAI peut mettre à jour le code d’un module après une mise à niveau du CLI :

```bash
sf update
# Detects version mismatch
# Offers to update module code
? Update Email module to latest version? Yes
```

Le système applique une fusion à trois sources :

1. **Base** — code généré à l’origine, identifié par le hash du manifeste ;
2. **Current** — code modifié dans votre projet ;
3. **Target** — nouveau code du modèle.

Stratégies :

- ✅ **mise à jour automatique** si le fichier est intact et le modèle a changé ;
- ⚠️ **conflit** si les deux ont changé, avec la nouvelle version dans `.saasfoundry.new` ;
- ⏭️ **aucune action** si le fichier a changé mais pas le modèle.

## Ajouter un module personnalisé

1. Créez les fichiers d’overlay dans `scaffolds/overlays/modules/`.
2. Créez l’installateur dans `src/installers/`.
3. Ajoutez les marqueurs `TODO` dans les blueprints.
4. Mettez à jour les types et les prompts.

Voir [Développement — ajouter un module ou une compétence](/fr/contributing/development#ajouter-un-module-ou-une-competence).

## Bonnes pratiques

1. Ajoutez les modules tôt, avant d’accumuler du code spécifique au produit.
2. Utilisez Docker pour le stockage et la base de données de développement.
3. Testez aussi en mode production : certains modules s’y comportent différemment.
4. Gardez les fichiers `.env` synchronisés pour éviter la dérive de configuration.

## Pour aller plus loin

- [Module e-mail](/fr/modules/email)
- Lancez `sf update` pour ajouter des modules au projet.
- Consultez `src/installers/` pour comprendre leur installation.
