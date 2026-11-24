# Module Email — MailerSend

Emails transactionnels propulsés par [MailerSend](https://mailersend.com).

## Vue d'ensemble

Le module relie un fournisseur transactionnel de production aux parcours d'authentification de chaque projet généré :

- ✅ confirmation de compte, réinitialisation du mot de passe et invitation ;
- ✅ modèles HTML et texte en anglais et en français ;
- ✅ mode développement sans fournisseur, avec rendu dans les logs ;
- ✅ boîte de réception locale prête à l'emploi : avec le module, les services de développement démarrent [Mailpit](https://mailpit.axllent.org) et l'API y envoie ses emails au lieu de MailerSend ;
- ✅ fournisseur isolé derrière un unique `MailerSendService` ;
- ✅ clé factice en test pour garder les E2E hors ligne.

## Ce que le module ajoute réellement

Le socle contient déjà `EmailService`, la traduction et les six modèles. Le module ajoute l'envoi réseau :

- `MailerSendService`, wrapper du SDK `mailersend` ;
- activation des marqueurs `TODO mailer-service-active:` dans les services concernés ;
- enregistrement du provider dans `email.module.ts` ;
- activation du test E2E en renommant `email.service.disabled-spec.ts` ;
- configuration de `.env`, `.env.test` et de la référence au secret GitHub Actions ;
- capteur d'emails de développement : un service Mailpit dans `docker-compose.dev-services.yml` et une ligne `MAIL_CATCHER_URL` dans le `.env` de développement (voir
  [Développement local avec le capteur d'emails](#developpement-local-avec-le-capteur-d-emails)).

Sans le module, les parcours fonctionnent et les emails rendus apparaissent dans les logs du serveur.

## Installation

### Pendant la création

```bash
sf new
# Activer MailerSend, puis fournir :
# - la clé API
# - l'adresse d'expédition
# - le nom d'expédition
```

### Dans un projet existant

```bash
sf update --add-modules email \
  --mailersend-api-key "$MAILERSEND_KEY" \
  --mailersend-sender-email noreply@myapp.com \
  --mailersend-sender-name "My SaaS App"
```

L'installateur copie le service, active les marqueurs, enregistre le provider, active le test et remplace les placeholders de configuration. Il ajoute aussi le service Mailpit à
`docker-compose.dev-services.yml` (le fichier est créé si le projet n'héberge aucun autre service Docker), choisit son port hôte, l'enregistre comme `ports.mail` dans `.saasfoundry.json` et renseigne
`MAIL_CATCHER_URL` dans le `.env` de développement.

## Les trois parcours intégrés

| Parcours                  | Déclencheur                   | Service                       | Modèle                             |
| ------------------------- | ----------------------------- | ----------------------------- | ---------------------------------- |
| Confirmation du compte    | `POST /api/auth/signup`       | `AuthService.signup()`        | `templates/account-confirmation/*` |
| Mot de passe oublié       | `POST /api/auth/reset`        | `AuthService.resetPassword()` | `templates/password-reset/*`       |
| Invitation d'organisation | Un membre invite une personne | `InvitationService.create()`  | `templates/invitation/*`           |

Chaque parcours construit un lien `{baseUrl}?token=...`, rend `{html, text}` puis délègue à `MailerSendService.sendEmail()`.

### Utiliser `EmailService` dans un module métier

```typescript
import { EmailService } from '@modules/email/services/email.service'

@Injectable()
export class BillingService {
  constructor(private readonly emailService: EmailService) {}

  async sendReceipt(user: User, invoice: Invoice) {
    await this.emailService.sendReceiptEmail(user.email, invoice.id, user.firstName, user.locale)
  }
}
```

Gardez `EmailService` comme interface publique. `MailerSendService` reste un détail d'implémentation.

## Configuration

### Variables d'environnement

Les variables suivantes sont obligatoires en production dans `apps/api/.env` :

```env
MAILERSEND_API_KEY="ms_prod_xxxxxxxxxxxxxxxxxxxxxxxx"
MAILERSEND_SENDER_EMAIL="noreply@myapp.com"
MAILERSEND_SENDER_NAME="My SaaS App"
FRONTEND_URL="https://app.myapp.com"
```

`FRONTEND_URL` sert aux liens de confirmation, reset et invitation.

Facultative, **réservée au développement** (le `apps/api/.env` de votre machine, jamais le workflow de déploiement) :

```env
MAIL_CATCHER_URL="http://localhost:8025"
```

Tant qu'elle est définie, l'API envoie tous les emails à la boîte Mailpit locale au lieu de MailerSend. C'est un interrupteur explicite : la production ne peut pas y basculer en silence, et l'API
refuse de l'utiliser lorsque `NODE_ENV` vaut `production`.

### Mode test

`.env.test` reçoit une clé déterministe et factice :

```env
MAILERSEND_API_KEY="ms_test_fake_key_12345abcdef67890ghijklmnopqrstuvwxyz"
MAILERSEND_SENDER_EMAIL="noreply@myapp.com"
MAILERSEND_SENDER_NAME="My SaaS App"
```

Les tests remplacent l'appel HTTP : ils prouvent la mise en file sans envoyer d'email réel.

### CI et déploiement

Le workflow de déploiement référence un secret GitHub :

```bash
gh secret set MAILERSEND_API_KEY --body "$MAILERSEND_KEY"
```

Le nom et l'adresse d'expédition ne sont pas secrets et restent versionnés.

## Modèles

Chaque parcours possède un modèle HTML, un modèle texte et des traductions anglaises et françaises :

```text
apps/api/src/modules/email/
├── locales/
│   ├── en.ts
│   └── fr.ts
├── templates/
│   ├── account-confirmation/{html,text}.template.ts
│   ├── password-reset/{html,text}.template.ts
│   └── invitation/{html,text}.template.ts
└── services/
    ├── email.service.ts
    ├── mailersend.service.ts
    └── translation.service.ts
```

### Modifier un modèle

1. Modifiez `html.template.ts` et/ou `text.template.ts` pour le parcours concerné.
2. Ajoutez chaque nouvelle clé dans **les deux fichiers** `locales/en.ts` et `locales/fr.ts`.
3. Exécutez `npm run test:unit -- email`.

### Ajouter une locale

1. Créez par exemple `locales/es.ts` à côté de `en.ts` et `fr.ts`.
2. Importez-la dans `translation.service.ts` et étendez la table de dispatch.
3. Ajoutez la locale à l'enum Prisma `Locale` dans `prisma/schema/user.prisma`, puis synchronisez la base de développement.

## Développement local avec le capteur d'emails

Un projet qui a le module email peut terminer une inscription ou une invitation sur votre machine : les services de développement incluent [Mailpit](https://mailpit.axllent.org), un capteur d'emails,
et le `.env` de développement de l'API le désigne.

```bash
npm run services:up     # dans l'app API : démarre la base, MinIO (s'il est hébergé dans Docker) et Mailpit
```

Inscrivez-vous, invitez un membre ou demandez une réinitialisation de mot de passe : l'email arrive dans la boîte **http://localhost:8025** (le port est `ports.mail` dans `.saasfoundry.json` ; un
autre est choisi quand 8025 est pris, et `sf new` affiche l'URL de la boîte avec les autres). Ouvrez le message, cliquez sur le lien.

Fonctionnement :

- Le service `mail-dev` de `docker-compose.dev-services.yml` exécute `axllent/mailpit`. Le module l'ajoute **dès qu'il est installé**, même quand ni la base ni le stockage ne tournent dans Docker.
  Seul le port web est publié : l'API envoie par l'API HTTP de Mailpit (`POST /api/v1/send`), donc sans client SMTP ni dépendance supplémentaire.
- `MAIL_CATCHER_URL` dans `apps/api/.env` est l'interrupteur explicite. Supprimez la ligne (ou commentez-la) pour envoyer de nouveau par MailerSend. Elle n'est écrite que dans le `.env` de
  développement, jamais dans le workflow de déploiement ni dans `.env.test`, et l'API refuse de l'utiliser lorsque `NODE_ENV` vaut `production`.
- `sf new` (et `sf resume`) démarrent la boîte avec la base et MinIO que vous avez choisi d'exécuter dans Docker. Un projet qui n'en héberge aucun dans Docker (base et bucket hébergés) garde
  `mail-dev` dans le compose pour `npm run services:up` : aucun conteneur n'est lancé pour quelqu'un qui n'a jamais demandé Docker, et `sf new` affiche l'URL de la boîte marquée comme non démarrée.
- La boîte n'a pas de volume : recréer le conteneur la vide.
- `.env` n'est pas versionné : renseignez `MAIL_CATCHER_URL` dans le `.env` de chaque clone qui doit utiliser le capteur.

`sf new --email-service none` ne change pas : pas de module email, pas d'envoi, et le jeton de confirmation reste dans le log de l'API.

### Sans le module

L'absence du module est un mode de développement valide : les contenus rendus sont journalisés. Installez le module lorsqu'il vous faut une vraie boîte (le capteur ci-dessus) ou la délivrabilité
réelle (préproduction, production).

Avec le module installé et sans capteur, évitez une vraie clé sur une branche de fonctionnalité : supprimez `MAIL_CATCHER_URL` et utilisez la clé factice. Elle provoque un rejet explicite sans
contacter un compte de production ; les logs conservent le contenu de débogage.

## Configurer le compte MailerSend

1. Créez le compte.
2. Vérifiez un domaine d'expédition.
3. Créez un token limité au droit d'envoyer des emails.
4. Déclarez une identité comme `noreply@<domaine-vérifié>`.
5. Fournissez le token à `sf new` ou `sf update`.

## Dépannage

### Les emails n'arrivent pas

- `MailerSend error` : inspectez le domaine, la clé et la limite de débit.
- aucune ligne : vérifiez `MailerSendService` dans `email.module.ts` et installez le module si nécessaire.
- un identifiant de message est présent : consultez l'activité MailerSend pour les bounces et blocages.

### `Failed to send email: fetch failed`

Vérifiez l'accès HTTPS sortant à `api.mailersend.com` et la présence de `MAILERSEND_API_KEY`.

### « The mail catcher at http://localhost:8025 did not answer »

`MAIL_CATCHER_URL` est défini dans `apps/api/.env` mais Mailpit ne tourne pas. Démarrez-le avec `npm run services:up` (ou `docker compose -f docker-compose.dev-services.yml up -d mail-dev`, ou
`sf resume`), ou supprimez la ligne pour envoyer par MailerSend. Si le port a changé, `ports.mail` dans `.saasfoundry.json` et le port de `MAIL_CATCHER_URL` doivent concorder.

### « MAIL_CATCHER_URL is a development setting »

L'API tourne avec `NODE_ENV=production` et `MAIL_CATCHER_URL` défini. Retirez la variable de cet environnement : le capteur est réservé au développement.

### Les tests envoient réellement

Vérifiez `NODE_ENV=test` et le chargement de `.env.test`, jamais `.env`.

### Le HTML semble cassé

Testez dans de vrais clients email. Les règles inline et le support CSS diffèrent d'un navigateur classique.

## Comportement de `sf update`

Les fichiers activés diffèrent du blueprint initial. Le merge à trois voies considère vos modifications comme du contenu utilisateur et propose des conflits au lieu de réappliquer les marqueurs.

Gardez les personnalisations dans `locales/` et `templates/`, que l'installateur ne réécrit pas, afin que les mises à jour de service restent propres.

### Projets créés avant le capteur d'emails

Un projet dont `modules.email.version` vaut 1 reçoit le capteur par `sf update` (la migration du module email, v1 → v2). Elle :

- ajoute le service `mail-dev` à `docker-compose.dev-services.yml` (en créant le fichier si le projet n'en a pas), sur le premier port hôte libre à partir de 8025, et l'enregistre comme `ports.mail` ;
- renseigne `MAIL_CATCHER_URL` dans `apps/api/.env`, sauf si ce fichier le définit déjà : **vos emails vont donc dans la boîte dès cette mise à jour**, supprimez la ligne pour continuer d'envoyer par
  MailerSend ;
- réécrit `mailersend.service.ts` et ajoute la variable facultative `MAIL_CATCHER_URL` à `env.service.ts`. Un fichier que vous avez modifié reste tel quel : le changement est écrit à côté, dans
  `<fichier>.saasfoundry.new`, et les deux fichiers avancent toujours ensemble, de sorte qu'un service qui lit la variable ne rencontre jamais un schéma qui ne la déclare pas. Fusionnez les sidecars,
  et le capteur est actif ;
- ne change rien dans un projet sans le module (`--email-service none`).

`sf update --dry-run` liste ces changements sans les appliquer. Démarrez la boîte avec `npm run services:up` dans l'app API.

## Étapes suivantes

- [Module Storage](/fr/modules/storage)
- [Système de modules](/fr/guide/module-system)
- [Mettre à jour un projet](/fr/guide/updating-projects)

## Commandes associées

- [`sf new`](/fr/cli/sf-new)
- [`sf update`](/fr/cli/sf-update)
