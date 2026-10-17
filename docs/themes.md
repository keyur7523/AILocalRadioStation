# Player themes

Every colour combination tried for the listener page, kept so a future
**theme picker** can offer them by name. The live site uses **Daylight** in
light mode and **Evening** in dark mode, following the device setting.

## How a theme maps onto the page

Each theme fills the same tokens in [`frontend/app/globals.css`](../frontend/app/globals.css):

| Token | What it colours |
|---|---|
| `--bg` | page background |
| `--glow-1/2/3`, `--glow-opacity` | the three soft pools of colour behind the glass |
| `--glass`, `--edge` | the frosted player card and its bright rim |
| `--glass-solid` | the card when transparency is turned down |
| `--text`, `--text-2`, `--text-3` | main text, supporting text, small labels |
| `--accent` (+ `-bright`, `-deep`, `-glow`) | play button, "on air" light, volume fill |
| `--on-accent` | the play icon on the accent |

A picker would move each theme's values under `[data-theme="<name>"]`, set that
attribute on `<html>`, and remember the choice per listener. A light theme
should be paired with a dark one, as Daylight is with Evening.

## In use

### 4 · Daylight (light mode)

Warm paper with peach, lilac and sky; tomato-red play.

| bg | glow 1 | glow 2 | glow 3 | glass | text | text 2 | accent | on accent |
|---|---|---|---|---|---|---|---|---|
| `#F4F1EC` | `#FFC9A8` | `#C9B8FF` | `#A8D8FF` | white 55% | `#14161C` | `#4A5160` | `#E2553A` | `#FFFFFF` |

### 4d · Evening (dark mode)

Daylight's colours after sunset.

| bg | glow 1 | glow 2 | glow 3 | glass | text | text 2 | accent | on accent |
|---|---|---|---|---|---|---|---|---|
| `#1C1A22` | `#C98A6B` | `#8C7CC9` | `#6E9CC4` | white 7% | `#F4EFEA` | `#BDB4AC` | `#F08A6E` | `#2A120B` |

## Also on file

Light themes use glass at white 50–55%; dark themes use white 7–9%.

| # | Name | Mode | bg | glows | text / text 2 | accent | Feel |
|---|---|---|---|---|---|---|---|
| 4a | Soft daylight | light | `#F7F4F0` | `#FFDCC7` `#DDD2FF` `#C6E4FF` | `#1B1D24` / `#5A6070` | `#D9654B` | Daylight, quieter |
| 4b | Golden hour | light | `#FBF5EE` | `#FFC7A1` `#F7B9C8` `#FFE3A3` | `#24170F` / `#6B5A4E` | `#D9702E` | warmer, more "radio" |
| 4c | Daylight by the sea | light | `#F5F4F0` | `#FFCDB0` `#D1C6FF` `#B8EADF` | `#152224` / `#506063` | `#2A9D8F` | peach and lilac with mint |
| 3a | Sea glass | light | `#F2F8F7` | `#BFEDE4` `#CADFF8` `#E4F4CF` | `#12302D` / `#557270` | `#2A9D8F` | the gentlest |
| 3b | Morning tide | light | `#F3F7FB` | `#B5E6DF` `#D3DAFF` `#D9F3E8` | `#15263A` / `#566A80` | `#3A8FB7` | cool and bright |
| 3c | Calm water | dark | `#15262C` | `#4C9A92` `#5B7DB1` `#8DB596` (40%) | `#E8F1F0` / `#A9BFBD` | `#8ED9CC` | soft ocean at night |
| 3 | Ocean drive | dark | `#06161A` | `#19C2B0` `#2F7BFF` `#B6F36A` | `#EEFBFA` / `#9DC4C2` | `#3BE0C8` | fresh, modern, vivid |
| 1 | Late-night radio | dark | `#0B0F1A` | `#5B4BFF` `#FF6FB5` `#FFB547` | `#F5F7FA` / `#A9B1C3` | `#FFB547` | calm, after-hours |
| 2 | Sunset FM | dark | `#1A0E14` | `#FF6B5B` `#7B5CFF` `#FFB38A` | `#FFF6F0` / `#E0BDB4` | `#FF8A5B` | warm drive-time; its coral "on air" label needs a lighter colour over the coral glow |
| 0 | Original | dark | `#14100C` | amber spotlight | `#F4ECE0` / `#B6A890` | `#F2A93B` | the first design: flat, hard-to-read small text |

Natural pairs for light/dark: Daylight and Evening; Sea glass or Morning tide
with Calm water.
