# Voxy

An ENS wallet recovery frontend concept with an animated ASCII portal, skippable pixel-assembly and tunnel intro, pointer-responsive identity card, interactive recovery explorer, and Lenis smooth scrolling. The scene includes motion pause and intro replay controls. Reduced-motion preferences skip the intro and disable ongoing motion.

Run `npm install`, then `npm run dev`. `npm run build` produces a static site in `dist/`. `npm test` checks ENS preview input validation and ASCII frame rendering.

The setup and recovery interactions are explicitly illustrative. No ENS lookup, wallet connection, contract call, or transaction is performed. Production integration requires a specified recovery contract and compatible wallet. The preview accepts basic ASCII `.eth` names only; production ENS names require ENSIP-15 normalization.

Design: charcoal portal scenes, warm ivory, signal orange, Sora and DM Mono; shaded ASCII glyphs, reduced-motion support, native accessible dialogs and FAQ disclosure elements. Recovery steps use accessible tabs with Up/Down, Home, and End keyboard support.
