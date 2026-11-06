# Voxy design direction

Audience: ENS holders exploring a more understandable wallet recovery experience.
Register: brand landing page with an interactive product preview.
Direction: retro-futuristic web3 portal; charcoal, signal orange, ivory, oversized typography, a visible pixel field, and an animated ASCII recovery portal. The user requested a more expressive web3 identity, loading animations, dithering, and Lenis smooth scrolling.

The memorable element is the ASCII torus framing an ENS identity card. Sora carries the editorial headlines and body; DM Mono appears only in short technical labels. The committed orange appears in the portal, ticker, and action buttons. CSS custom properties use OKLCH values.

Motion follows the awwwards polish lens: a 2.2-second skippable intro assembles you.eth from scattered pixels, accelerates through elliptical gates, and opens an iris into the hero. It has no loading bar or oversized wordmark. A 24 fps ASCII torus rotates and responds to the pointer; the identity card tilts independently. Orbital details carry motion through the page; the ticker was removed at the user’s request. This is an intro sequence, not a simulated network progress indicator. Motion pauses when hidden or offscreen; the explicit pause control also freezes CSS animation. Reduced-motion preferences skip the intro, stop the render loop, and disable smoothing. Native dialogs retain keyboard focus; FAQs use native disclosure elements.

Implementation uses the browser canvas to draw shaded ASCII characters and the actual Lenis library for scrolling. Three.js, anime.js, and Framer Motion are unnecessary for this surface. No separate dither, color-expert, motion-principles, impeccable, or agent-browser skills were found in the installed skill directories; their relevant palette, motion, and audit principles were applied directly.

Verification: production build, name-validation checks, and deterministic animated ASCII-frame checks pass. The earlier revised desktop hero was visually inspected in native Chrome. Native capture returned a blank surface when verifying the replacement intro, so that sequence is visually unverified. Browser connector access is unavailable; native interaction checks timed out. Full interaction and mobile screenshot QA remain unverified. Publication remains blocked by DNS access to the Sites source host.

Screenshot-directed refinement: removed the header and hero-footer dividers, faded portal labels, scroll prompt, and orange ticker. Replaced the pastel recovery cards with a keyboard-accessible three-step explorer and changed typography to Sora. Native screenshots returned a blank capture during this pass, so the updated layout remains visually unverified.
