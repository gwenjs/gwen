---
title: Tween & Animation
description: Interpolation déclarative de valeurs pour des animations fluides.
---

# Tween & Animation

Les tweens sont la façon standard d'animer des valeurs numériques, des vecteurs et des couleurs dans GWEN. Au lieu de gérer manuellement l'état de l'animation, vous déclarez une valeur de départ, une valeur finale et une durée—le moteur gère l'interpolation et applique une courbe de facilitation.

## Les bases

Créez un tween à l'intérieur d'un système en utilisant `useTween()` :

```ts
import { useTween, defineSystem, onUpdate } from '@gwenjs/core'

export const FadeSystem = defineSystem(() => {
  const opacity = useTween<number>({
    duration: 0.5,
    easing: 'easeInOut',
  })

  onUpdate(() => {
    // opacity.value se met à jour automatiquement à chaque image
    mesh.material.opacity = opacity.value

    // Lancez le tween lorsqu'une condition est remplie
    if (shouldFade && !opacity.playing) {
      opacity.play({ from: 1, to: 0 })
    }
  })
})
```

Le tween interpole automatiquement entre `from` et `to` sur `duration` secondes. La fonction `easing` façonne la courbe—dans ce cas, `easeInOut` commence lentement, accélère au milieu, puis ralentit à nouveau.

### Faciliteurs disponibles

GWEN inclut des fonctions de facilitation standard :

| Easing | Courbe | Cas d'usage |
|---|---|---|
| `linear` | Vitesse constante | Transitions UI, mouvement régulier |
| `easeIn` | Démarrage lent | Emphase ciblée |
| `easeOut` | Fin lente | Décroissance naturelle |
| `easeInOut` | Démarrage et fin lents | Animations UI fluides |
| `easeInBack` | Léger dépassement au démarrage | Entrées dynamiques |
| `easeOutBack` | Léger dépassement à la fin | Sorties dynamiques |
| `easeInBounce` | Démarrage rebondissant | Effets d'impact |
| `easeOutBounce` | Fin rebondissante | Effets d'atterrissage |

Vous pouvez également fournir une fonction de facilitation personnalisée : `(t: number) => number` où `t` varie de 0 à 1.

## Chaîner les tweens

Mettez en file d'attente plusieurs segments avec `.to()` :

```ts
import { defineSystem, useTween, onUpdate } from '@gwenjs/core'

const AnimationSystem = defineSystem(() => {
  const position = useTween<Vec2>({ duration: 0.2 })

  onUpdate(() => {
    if (shouldStartAnimation && !position.playing) {
      position
        .play({ from: { x: 0, y: 0 }, to: { x: 100, y: 50 } })
        .to({ value: { x: 100, y: 100 }, duration: 0.3 })
        .to({ value: { x: 0, y: 100 }, duration: 0.2 })
    }
  })
})
```

Chaque appel à `.to()` met en file d'attente une animation de suivi. Lorsque le segment actuel se termine, le suivant commence automatiquement.

### Contrôler la lecture

```ts
const tween = useTween<number>({ duration: 1 })

onUpdate(() => {
  if (someCondition) {
    tween.pause()  // Geler à la valeur actuelle
  } else {
    tween.play({ from: 0, to: 1 })  // Reprendre ou démarrer
  }

  if (otherCondition) {
    tween.reset()  // Arrêter et réinitialiser à l'état initial
  }
})
```

### Rappels

Écoutez les jalons de l'animation :

```ts
const scale = useTween<number>({ duration: 0.3 })

scale.onComplete(() => {
  console.log('Animation de mise à l\'échelle terminée')
  actor.togglePhase()
})

scale.onLoop(() => {
  console.log('Itération bouclée commencée')
})
```

### Boucle et Yoyo

Répétez les animations indéfiniment ou inversez-les :

```ts
import { defineSystem, useTween, onUpdate } from '@gwenjs/core'

const BobbingSystem = defineSystem(() => {
  const bobbing = useTween<number>({
    duration: 1,
    loop: true,
    yoyo: true,  // Inverser la direction après chaque cycle
  })

  onUpdate(() => {
    if (!bobbing.playing) {
      bobbing.play({ from: 0, to: 1 })
    }
  })
})
```

Avec `loop: true` et `yoyo: true`, le tween rebondit d'avant en arrière : 0 → 1 → 0 → 1, etc.

## En pratique

### Animation d'apparition d'ennemi

Les ennemis changent d'échelle de 0 à 1 en 0,2 secondes lorsqu'ils sont générés :

```ts
import { defineSystem, usePrefab, useTween, onUpdate } from '@gwenjs/core'
import { Position, Scale } from './components'
import { EnemyPrefab } from './prefabs'

export const EnemySpawnSystem = defineSystem(() => {
  const scale = useTween<number>({ duration: 0.2, easing: 'easeOut' })
  const enemies = usePrefab(EnemyPrefab)

  onUpdate(() => {
    if (shouldSpawns) {
      const id = enemies.spawn({ x: 100, y: 100 })
      Scale.x[id] = 0
      Scale.y[id] = 0
      
      if (!scale.playing) {
        scale.play({ from: 0, to: 1 })
      }
      
      // Mettre à jour l'échelle à chaque image
      Scale.x[id] = scale.value
      Scale.y[id] = scale.value
    }
  })
})
```

### Fondu d'interface utilisateur

Faire disparaître progressivement un panneau de dialogue au démarrage d'une scène :

```ts
import { defineSystem, useTween, onUpdate } from '@gwenjs/core'

export const DialogSystem = defineSystem(() => {
  const alpha = useTween<number>({ duration: 0.4, easing: 'easeIn' })

  onUpdate(() => {
    if (!alpha.playing) {
      alpha.play({ from: 0, to: 1 })
    }
    
    dialogPanel.opacity = alpha.value
  })
})
```

## Sous le capot

### Pool de tweens

Le moteur gère les tweens dans un pool pour éviter la pression d'allocation. Chaque tween occupe une fente, et la fente est réutilisée lorsque le tween se termine. Si vous créez des tweens dynamiquement (par exemple, un par ennemi), le pool garantit qu'aucune allocation ne se produit pendant le gameplay.

### Performance

Les tweens sont extrêmement efficaces :
- À chaque image, seul le temps actuel est avancé.
- Les fonctions de facilitation sont des opérations mathématiques légères.
- L'interpolation se fait côté client ; aucun trafic réseau.

Avec des centaines de tweens simultanés, les performances restent fluides.

### Annulation

Si vous avez besoin d'arrêter un tween tôt, appelez `reset()`. La fente n'est pas libérée automatiquement—les travaux futurs ajouteront des crochets de cycle de vie pour gérer le nettoyage.

## Résumé de l'API

| Fonction | Description |
|---|---|
| `useTween<T>(options)` | Créer un tween à l'intérieur d'un système ; renvoie un `TweenHandle<T>` |
| `tween.play(segment)` | Démarrer l'animation de `from` à `to` sur `duration` |
| `tween.pause()` | Geler à la valeur actuelle (ne pas réinitialiser) |
| `tween.reset()` | Arrêter et réinitialiser à l'état initial |
| `tween.to(segment)` | Mettre en file d'attente une animation de suivi |
| `tween.onComplete(cb)` | Appelé lorsque le segment actuel se termine |
| `tween.onLoop(cb)` | Appelé à chaque fois que `loop: true` boucle |
| `tween.value` | Valeur actuellement interpolée (lecture seule) |
| `tween.playing` | Indique si l'animation est active (lecture seule) |

## Prochaines étapes

- **[Physique](/fr/physics/physics2d-composables)** — Animer les corps de physique avec des contraintes.
- **[Scènes](/fr/essentials/scenes)** — Apprenez à coordonner les animations sur plusieurs acteurs.
- **[Mode debug](/fr/advanced/debug-mode)** — Visualiser le minutage des tweens dans le profileur.
