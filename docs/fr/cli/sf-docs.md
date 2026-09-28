# sf docs

Ouvrez la documentation SaaSFoundryAI servie depuis votre propre installation, sans connexion réseau.

La documentation que vous consultez est incluse dans le package npm. `sf docs` démarre un petit serveur local sur un port libre et l'ouvre — dans un avion, derrière un proxy d'entreprise ou avant même
qu'un site ait été publié.

## Utilisation

```bash
sf docs [--port <port>] [--no-open]
```

## Options

| Option          | Description                              | Valeur par défaut           |
| --------------- | ---------------------------------------- | --------------------------- |
| `--port <port>` | Utiliser un port précis                  | premier port libre dès 5177 |
| `--no-open`     | Afficher l'URL sans ouvrir de navigateur | ouvre le navigateur         |

## Sortie affichée

```
  📚 SaaSFoundryAI documentation  v1.0.0

     served from this installation — no network needed

     http://localhost:5177

     Ctrl+C to stop
```

La version indiquée est celle du CLI. Ce détail est important : vous savez ainsi si vous lisez la documentation correspondant réellement à la version exécutée, ou celle d'une autre installation
présente sur la machine.

## Pourquoi une documentation locale

Chaque commande `npx saasfoundryai-cli …` de ces pages renvoyait auparavant vers un site qui n'avait jamais été déployé. Une personne ayant installé le CLI n'avait donc aucune documentation : le
package publié contenait `dist`, `bin` et `scaffolds`, mais pas le site compilé.

Inclure le site dans le package rend la documentation disponible dès que le CLI l'est. Cela rend aussi **impossible qu'une release embarque une documentation plus ancienne qu'elle-même** : le site est
recompilé pendant la création du package, pas lors d'une étape manuelle facile à oublier.

Une version en ligne viendra plus tard. La copie locale ne sera pas un simple dispositif transitoire : elle restera celle qui correspond toujours au binaire installé devant vous.

## Ports

La commande choisit le premier port libre à partir de 5177. Deux serveurs peuvent ainsi fonctionner côte à côte, sans conflit avec l'application web d'un projet généré (5173) ni avec le serveur de
développement de la documentation utilisé par les contributeurs (5176).

## Voir aussi

- [`sf status`](/fr/cli/sf-status) — identifier le projet et vérifier s'il peut démarrer
- [`sf resume`](/fr/cli/sf-resume) — terminer une configuration interrompue à la dernière étape
