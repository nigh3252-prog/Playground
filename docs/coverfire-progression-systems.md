# Coverfire: 30 progression systems

Coverfire (`coverfire.html`) is a top-down cover shooter test bed. The core is the same in every mode: spread punishes movement, bracing tightens aim, bloom and heat punish spraying, there's an active reload, enemies hit hard and telegraph their shots, and low cover absorbs shots when you hug it. The **only** thing each mode changes is *how the character grows*. Pick a mode from **Choose system** on the title screen.

Code layout:

| File | What's in it |
|---|---|
| `coverfire.html` | Engine: stat/modifier pipeline, event bus, ability slots (L1 / R1 / △), buffs, allies, world objects, menus |
| `coverfire/abilities.js` | 43 abilities (Mass Effect 3, Risk of Rain 2, Halo / Gears / Titanfall / Division / Quantum Break era) |
| `coverfire/systems-1.js` | Systems 1–15 and shared helpers |
| `coverfire/systems-2.js` | Systems 16–30 |

A system is a plain object with optional hooks: `setup`, `preRoom(go)`, `onExit(next)`, `update`, `hudLines`, `drawHud`, `drawWorld`, `onSlot`, `onInteract` and `summary`. Copy one to start a new experiment.

## Enemies, defenses and rooms (shared by every system)

**Enemy look.** This follows Hammer Formation's style: one flat shape per role, a dark outline, a small inner mark, and an HP ring drawn in the enemy's own color. Telegraph rings brighten in the enemy's color as it winds up.

**Defense layers.** These follow Mass Effect 3. Each layer has to be stripped before HP takes damage, which gives every tool a job.

| Layer | Look | Strong against it | Weak against it |
|---|---|---|---|
| Shields | blue ring, recharges after 4s | tech ×3 (Overload, Energy Drain), bullets ×1.2 | fire ×0.5 |
| Barrier | pulsing purple ring | biotics ×3 (Warp, Shockwave, Nova, Charge) | fire ×0.5 |
| Armor | thick yellow outline | fire ×2.5, explosives ×1.6, heavy single shots (60+) | small bullets ×0.45 |

Any layer makes an enemy immune to Pull/lift (it shows "PROTECTED") and halves stuns.

**Special enemies**
- **Bulwark:** a riot shield that blocks bullets from the front and turns slowly. Flank it, lob over it, or knock it down.
- **Skirmisher:** has a barrier and sidesteps when you hold a braced aim on it.
- **Projector:** recharges shields on every nearby ally. A priority target.
- **Swarmer:** comes in packs of fragile melee units.

**Heavies** (elite rooms and floor bosses)
- **Juggernaut:** unstoppable and armored, with a minigun. It crushes low cover it walks into.
- **Walker:** its armored core is sealed (takes 15% damage) while its two shielded gun pods live. It also lobs mortar shells.
- **Hive:** stationary, has a barrier, and keeps hatching swarmers.

**Rooms.** Six room sizes and six layout templates: scatter, pillars, trenches, bunker, alley, open. Some rooms are L-shaped, and layouts are randomly mirrored. Tiles:
- **brush** blocks sight but not bullets
- **pits** block movement but not bullets or sight
- **explosive barrels**
- **breakable crates** (brown low cover)

After each clear you choose between two doors (Hades/Isaac style), each labeled with the next room's type:
- **Combat**
- **Elite:** more elites plus a heavy, and a bonus pick
- **Challenge:** two waves, and a bonus pick
- **Treasure:** a free pick, no fight
- **Rest:** heal 40%
- **Boss:** the 4th room of every floor

**Quality of life**
- Movement speeds up to 2.5× (tunable) whenever no enemies are alive.
- A quick bar (◀ system ▶ ⛶) is always in the top right. ◀ and ▶ restart instantly in the previous or next system.

---

## The 30

Each entry is laid out as: the hook, **What it tests**, then the **Watch for** question.

### 1. Draft (Hades / Synthetik)
Pick 1 of 3 after every room, and an ability every other room. **The control group.**
**Tests:** Is "small choice, often" enough on its own?
**Watch for:** Does the cover/accuracy loop feel different by room 8, or just bigger?

### 2. Item Stacks (Risk of Rain 1 & 2)
No choices. Gold buys chests and items stack, with on-hit procs (Ukulele, Sticky Bomb, AtG). **The clock raises difficulty**, so lingering is punished.
**Tests:** Accumulation and emergent synergy, without decision fatigue. Bustling Fungus (heal while standing still) is a natural fit for a "stand still to shoot" game.
**Watch for:** The pressure between the time-scaling and the "stay in cover" loop. Does it push you out of cover?

### 3. Class & Power Ranks (Mass Effect 3)
Six classes, a weapon-weight choice (lighter weapons recharge powers faster), XP to skill points, ranks 4–6 with A/B forks. **Prime then detonate** combos: Pull or Overload marks an enemy (dashed ring), and Warp, Concussive or Nova detonates it.
**Tests:** Identity is set up front, then you refine it. The combo layer rewards *sequencing* abilities rather than spamming them.
**Watch for:** Weight vs. recharge is a great "gun or powers?" dial for Warden.

### 4. Spell Deck (One Step From Eden)
Abilities are cards. You hold 2 (L1 / R1), they cost mana, △ reshuffles, and you can add, remove or upgrade cards.
**Tests:** You don't get to choose which ability is ready. Deck thinning is a progression decision too.
**Watch for:** Does randomness in your *hand* feel bad in a lethal cover shooter, or exciting?

### 5. Auto Board (The Bazaar)
A 10-slot board of items that **fire by themselves on cooldowns**. Duplicates raise the tier (Bronze, then Silver, then Gold, then Diamond). Gears and Rods buff their *neighbors*, so slot order matters. There's a shop between rooms.
**Tests:** You control positioning and aim, while the build plays itself. Arranging items is a real decision.
**Watch for:** Whether you still feel like the shooter, or like a spectator.

### 6. Slot Machine (Luck Be a Landlord)
Before each room you spin a 5×3 machine built from your symbol pool. Symbols interact (Cat + Milk, Bee + Flower, Clover doubles its neighbors). Bombs are your *only* grenades. **Rent** is due every 3 rooms.
**Tests:** Progression as a pool you curate, not stats you stack, plus an economy deadline.
**Watch for:** Variance per room ("this room I'm a tank, next room I'm fast").

### 7. Parasites & Adrenaline (Returnal)
Every upgrade has a downside. Removing one costs HP. Malignant rewards bring malfunctions that you repair by meeting an objective. **Adrenaline** levels climb with kill streaks and vanish when you're hit.
**Tests:** Tradeoff-only upgrades, plus a skill-gated temporary power curve.
**Watch for:** Adrenaline fits "enemies are lethal" very well, because the reward is not getting hit.

### 8. Auto-Weapons & Level-Ups (Vampire Survivors)
Swarms drop XP gems, and **level-ups pause mid-fight**. Auto-weapons (Wand, Garlic, Bible…) **evolve** when maxed alongside their matching passive.
**Tests:** Mid-combat power spikes and recipe-hunting.
**Watch for:** A swarm game and a cover game pull in opposite directions. Find where they meet.

### 9. Passive Web (Path of Exile)
A big tree with six themed branches, notables, skill-gem nodes, and **keystones that break rules**:
- Point Blank
- Resolute Technique (zero spread, but no crits)
- Chaos Inoculation (1 HP, triple armor)
- Acrobatics
- Blood Magic (abilities cost HP)
- Perfect Rhythm

**Tests:** Long-horizon planning ("I'm pathing toward that keystone").
**Watch for:** Keystones that rewrite the accuracy or cover rules are the most interesting part.

### 10. Learn by Doing (Skyrim / Final Fantasy II)
**No menus at all.** You get better at what you do: hit things to level Marksman, take damage to level Endurance, kill from cover to level Composure. Level 5 in a skill unlocks a perk.
**Tests:** The playstyle *is* the build. The game watches you instead of asking you.
**Watch for:** Does it reinforce good habits (bracing, cover) or let you farm?

### 11. Loot Guns (Borderlands / Diablo)
Procedurally generated guns: type × manufacturer × rarity. Manufacturer quirks:
- Jakobs: semi-auto, hits hard
- Hyperion: gets *more* accurate as you fire
- Tediore: reloading throws the gun as a grenade
- Torgue: explosive rounds
- Maliwan: always elemental
- Dahl: bursts when braced

You carry two and swap with △.
**Tests:** Progression lives in the *gun*, and manufacturers bend the accuracy model.
**Watch for:** Hyperion's reverse bloom is a neat inversion of the core rule.

### 12. Wand Programming (Noita)
Your gun is a **program**: projectile cards, modifiers and multicasts fire left to right. The "reload" is the wand recharge, and perfect reloads still work.
**Tests:** Building as authoring. The order of cards is the skill.
**Watch for:** The highest ceiling of anything here, and also the most confusing. Watch for "aha" moments.

### 13. Cyberware Capacity (Cyberpunk 2077 / Armored Core)
Body slots plus a capacity budget. You collect chrome into a stash and **freely reinstall** everything between rooms.
**Tests:** A build you can reconfigure, versus permanent picks. Choices are about fitting a budget, not about what to keep forever.
**Watch for:** Do you experiment more when nothing is permanent?

### 14. Style Rank + Jokers (Devil May Cry × Balatro)
A live D→SSS meter buffs damage and fire rate, and repeating the same action decays it. Banked style buys **Jokers** that rewrite what counts as stylish (Stoic: no decay while braced; Wallflower: cover kills ×2).
**Tests:** In-room momentum, with meta-rules layered on top.
**Watch for:** Jokers that make *cover play* stylish. Is that the mode's identity?

### 15. Squad Command (Mass Effect / Dragon Age)
Recruit squadmates with their own powers. L1 / R1 fire *their* powers (like ME's power wheel), △ holds their position, and downed members can be revived. Upgrades mostly go into them, not you.
**Tests:** Progression handed to companions. You're a commander.
**Watch for:** AI allies in a lethal cover game. Do they feel like assets or liabilities?

### 16. Nemesis Trophies (Shadow of Mordor)
Every room has a named Captain with traits (Ironclad, Grenadier, Blinker, Vampiric…) and a known weakness. Kill him to steal a trait. **If he hurts you twice he escapes at low HP** and returns as a Nemesis with an extra trait.
**Tests:** Progression gained from enemies. Rivalry with a single enemy creates the story.
**Watch for:** Captains are memorable. This is the most narrative mode here.

### 17. Trait Synergies (Teamfight Tactics / Isaac)
Items carry tags (Fire, Tech, Biotic, Shadow, Iron, Hunter), and **2/4/6 of a tag switch on set bonuses**.
**Tests:** Committing to a theme vs. hedging. The draft becomes a puzzle.
**Watch for:** Iron 6 (half damage while hugging cover) sits right on top of the core loop.

### 18. Blood Price (Isaac devil deals)
No gold and no medkits. **Every upgrade costs max HP, permanently.**
**Tests:** A single currency that is also your survival.
**Watch for:** In a game where enemies are lethal, how low will you go?

### 19. Streak Ladder (Downwell / no-hit runs)
Clean rooms (no HP damage) climb a tier and lock in a perk. HP damage drops a tier, and **perks above your tier turn off**.
**Tests:** Power that depends on playing well, and that you can lose and win back.
**Watch for:** It makes armor (which doesn't count against you) meaningful.

### 20. Backpack (Backpack Hero / Backpack Battles)
A grid inventory:
- Whetstones boost side-adjacent weapon items.
- Gems boost all 8 neighbors.
- Daggers want empty neighbors.
- Cursed Idols halve their neighbors.

**Placement IS the build.**
**Tests:** A spatial puzzle as progression.
**Watch for:** The pace between rooms. Is this too much menu time?

### 21. Contracts (Hitman / CoD challenges)
Rewards come **only** from objectives, and each payout is shown up front ("Kill 3 while braced → Phase Round").
**Tests:** Progression that steers how you play. It's the game teaching its own tactics.
**Watch for:** This could double as a tutorial for the cover/brace loop.

### 22. Wagers (Hades Pact of Punishment)
Before each room, toggle handicaps: Glass Jaw, Shaky Hands (no brace), Hourglass, Blackout… More heat means more and better picks.
**Tests:** The player sets the difficulty for each room.
**Watch for:** "No Brace" and "Blackout" really change how the core plays. They're good for learning what's essential.

### 23. Gun Game (Counter-Strike Arms Race)
Every 2 kills you get the next of 12 guns. After the Golden Gun you prestige. Rewards skip, pin or speed up the ladder.
**Tests:** Progression that forces change. You can't settle into one weapon.
**Watch for:** It shows which guns suit the cover system and which don't.

### 24. Lineage (Rogue Legacy)
Pick 1 of 3 heirs with genetic traits (Near-Sighted, Gigantism, Colorblind = grayscale, Vertigo = colors are all wrong). Gold is **banked across runs** in the Manor upgrade shop. The only persistent mode.
**Tests:** Meta-progression. A losing run still earned something.
**Watch for:** Traits that change how the game *looks or feels*, not just its numbers.

### 25. Echoes (original)
Every room you play is recorded. In later rooms, ghosts of your earlier runs replay alongside you and shoot where you shot. Upgrades: more echoes, looping, auto-aim, echoes recasting your abilities, solid echoes that absorb bullets.
**Tests:** Your past play is the build.
**Watch for:** Deliberate play in one room pays off later. It's weird and very lateral.

### 26. On the Beat (Metal: Hellsinger / NecroDancer)
A metronome:
- On-beat shots deal ×1.6 (off-beat ×0.7).
- On-beat reloads are automatically perfect.
- On-beat dodges get double i-frames.
- Fury climbs to ×16.

**Tests:** Timing as the progression axis. The gun is semi-auto.
**Watch for:** Whether rhythm fights the "wait for the telegraph" flow or syncs with it.

### 27. Dice Equipment (Dicey Dungeons)
Roll dice every 8s, and unspent dice are lost. Your three slots are equipment cards that eat a die fitting their requirement (≥4, even, =6…), and the die's value sets the power.
**Tests:** A per-turn resource economy layered over a real-time shooter.
**Watch for:** Small puzzles mid-firefight. Is that delightful or distracting?

### 28. Paragon / Renegade (Mass Effect)
Two meters that fill from HOW you fight:
- Paragon fills from cover kills and perfect reloads.
- Renegade fills from close kills, moving kills and ability kills.

**Mid-fight interrupts** offer a choice: L1 Spare (the enemy becomes an ally) or R1 Execute. Between rooms you make conversation choices. Thresholds unlock each path's powers.
**Tests:** Morality as a build axis, earned through playstyle.
**Watch for:** Interrupts are a great hook for the bumpers.

### 29. Fortifications (Tower defense / Orcs Must Die)
You barely level up. **The arena does.** Each room opens with a build phase: spend points on sandbags, walls, turrets, mines, wire, a med station and Tesla coils. Then press △ to fight.
**Tests:** Progression moved into the environment. You design your own cover.
**Watch for:** It makes the cover system the *build*, which fits this game more directly than anything else here.

### 30. Decay (reverse roguelike)
You start god-tier with 15 things. **After every room you must lose one.** Each loss leaves a small ember (+3% damage, +4 HP).
**Tests:** Identity defined by what you keep.
**Watch for:** It reveals what players actually value in the kit.

---

## More ideas not built (yet)
- **Kit roulette** (Overwatch-ish): every room hands you a different hero kit. The only thing that persists is ultimate charge.
- **Map routing** (Slay the Spire / FTL): choose the next room by its reward icon (elite, shop, rest, event).
- **Breakable gear** (Breath of the Wild): every upgrade has a limited number of uses.
- **Tuning dials**: zero-sum sliders (damage ↔ fire rate, speed ↔ armor). Progression widens their range.
- **Super meter** (fighting games): damage dealt and taken fills bars, which you spend on EX versions of abilities.
- **Crafting** (Monster Hunter): enemy parts become recipes.
- **Stances** (Nioh): △ cycles Aggressive / Balanced / Marksman, and each stance has its own upgrade tree.
- **Hybrids worth trying:** Contracts + Draft, Fortifications + Squad, Streak Ladder + Style, and Nemesis + Loot Guns (captains drop their own gun).
