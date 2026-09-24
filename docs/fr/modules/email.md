# Module Email — MailerSend

Emails transactionnels propulsés par [MailerSend](https://mailersend.com).

## Vue d'ensemble

Le module relie un fournisseur transactionnel de production aux parcours d'authentification de chaque projet généré :

- ✅ confirmation de compte, réinitialisation du mot de passe et invitation ;
- ✅ modèles HTML et texte en anglais et en français ;
- ✅ mode développement sans fournisseur, avec rendu dans les logs ;
- ✅ fournisseur isolé derrière un unique `MailerSendService` ;
- ✅ clé factice en test pour garder les E2E hors ligne.

## Ce que le module ajoute réellement

Le socle contient déjà `EmailService`, la traduction et les six modèles. Le module ajoute l'envoi réseau :

- `MailerSendService`, wrapper du SDK `mailersend` ;
- activation des marqueurs `TODO mailer-service-active:` dans les services concernés ;
- enregistrement du provider dans `email.module.ts` ;
- activation du test E2E en renommant `email.service.disabled-spec.ts` ;
- configuration de `.env`, `.env.test` et de la référence au secret GitHub Actions.

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

L'installateur copie le service, active les marqueurs, enregistre le provider, active le test et remplace les placeholders de configuration.

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

```env
MAILERSEND_API_KEY="ms_prod_xxxxxxxxxxxxxxxxxxxxxxxx"
MAILERSEND_SENDER_EMAIL="noreply@myapp.com"
MAILERSEND_SENDER_NAME="My SaaS App"
FRONTEND_URL="https://app.myapp.com"
```

`FRONTEND_URL` sert aux liens de confirmation, reset et invitation.

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

Pour modifier un modèle, mettez à jour HTML et/ou texte, ajoutez les clés dans **les deux locales**, puis exécutez les tests email. Pour ajouter une langue, créez son fichier de locale, étendez le
dispatch et ajoutez-la à l'enum Prisma `Locale`.

## Développement local sans MailerSend

L'absence du module est un mode de développement valide : les contenus rendus sont journalisés. Installez le provider lorsque la délivrabilité réelle devient nécessaire.

Avec le module installé, évitez une vraie clé sur une branche de fonctionnalité. La clé factice provoque un rejet explicite sans contacter un compte de production ; les logs conservent le contenu de
débogage.

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

### Les tests envoient réellement

Vérifiez `NODE_ENV=test` et le chargement de `.env.test`, jamais `.env`.

### Le HTML semble cassé

Testez dans de vrais clients email. Les règles inline et le support CSS diffèrent d'un navigateur classique.

## Comportement de `sf update`

Les fichiers activés diffèrent du blueprint initial. Le merge à trois voies considère vos modifications comme du contenu utilisateur et propose des conflits au lieu de réappliquer les marqueurs.

Gardez les personnalisations dans `locales/` et `templates/`, que l'installateur ne réécrit pas, afin que les mises à jour de service restent propres.

## Étapes suivantes

- [Module Storage](/fr/modules/storage)
- [Système de modules](/fr/guide/module-system)
- [Mettre à jour un projet](/fr/guide/updating-projects)

## Commandes associées

- [`sf new`](/fr/cli/sf-new)
- [`sf update`](/fr/cli/sf-update)
