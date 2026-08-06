# pi-codex-fast-mode

Extension locale [Pi](https://pi.dev/) minimale pour activer le service tier prioritaire de Codex avec `/fast`.

## Fonctionnalités

- `/fast on` : active le fast mode pour le modèle courant.
- `/fast off` : le désactive pour le modèle courant.
- `/fast status` : affiche l'état courant.
- État conservé par `provider/api/model` dans la session Pi.
- Status bar : `FAST` en `rgb(255, 95, 255)` et `STD` en `rgb(95, 255, 95)`.
- Injection uniquement si le payload ne définit pas déjà `service_tier`.
- Aucun réglage Pi supplémentaire, raccourci clavier ou provider alternatif.

Le fast mode est volontairement limité à :

- provider `openai-codex` ;
- API `openai-codex-responses` ;
- authentification OAuth Codex ;
- modèles `gpt-5.4`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol` et `gpt-5.6-terra`.

Quand il est actif, l'extension ajoute au payload :

```json
{
  "service_tier": "priority"
}
```

Les clés OAuth ou autres credentials ne sont ni lus ni affichés par l'extension ; Pi vérifie seulement le mode d'authentification du modèle courant via son API interne.

## Installation depuis GitHub

Installation globale dans Pi :

```bash
pi install git:github.com/MurphySunset/pi-codex-fast-mode
```

Cette commande ajoute le package GitHub aux settings globaux de Pi. Elle ne référence pas le fichier local du dépôt de développement.

Après l'installation dans une session déjà ouverte :

```text
/reload
```

Sur un autre ordinateur, connectez d'abord Pi à OAuth Codex puis exécutez la même commande d'installation.

## Mise à jour

```bash
pi update --extensions
```

Pour mettre à jour uniquement ce package :

```bash
pi update git:github.com/MurphySunset/pi-codex-fast-mode
```

## Développement

Le point d'entrée est [`extensions/fast-mode.ts`](./extensions/fast-mode.ts). Pi charge directement le TypeScript ; aucune compilation n'est nécessaire pour l'utiliser.

Vérifications locales :

```bash
node --experimental-strip-types --check extensions/fast-mode.ts
bun build extensions/fast-mode.ts --outdir /tmp/pi-codex-fast-mode-build --target node
```

## Licence

MIT — voir [LICENSE](./LICENSE).
