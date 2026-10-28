compose.v3 — fixed instruction for a reference-part render by Muse Image.
Output: one opaque image (app-side RenderDescriptor).
Deterministic template; the app replaces {{editPrompt}} with the approved edit prompt. No model call expands it. Image 1 is always the base photo; image 2 is always the owned reference part.
v2 (2026-10-28): v1 front-wheel renders dropped the brake discs, calipers, and often the front fender (3 of 3 live runs); v2 kept them in its first live run. v3 (2026-10-28): the v2 rear-wheel render dropped the swingarm and final-drive arm that crosses the wheel in image 1, so the wheel rule now also keeps the parts that hold the wheel.

Edit image 1, a photo of a motorcycle. Replace only the one part described below with the part shown in image 2. Fit the new part to the motorcycle in image 1: match its perspective, scale, mounting position, and the lighting of image 1. Do not copy the background, other parts, or anything else from image 2. Keep the rest of the motorcycle, the background, the camera angle, the framing, and the image size of image 1 unchanged.

If the part is a wheel: take only the rim, spokes, hub, and their color and finish from image 2, and keep the tire of image 1. The brake discs of image 1 stay mounted on the new hub at the same size and position and stay visible through the spokes. The brake calipers stay on the fork legs or swingarm, gripping the discs as in image 1. The fender above the wheel stays in the same shape, color, and position as in image 1. The parts that hold the wheel stay exactly as in image 1: the fork legs and front axle, or the swingarm, final drive, and rear axle, including every part of them that crosses in front of the wheel. Keep these parts even if image 2 shows none. Do not add text, logos, people, or watermarks.

Requested change (description of the part, not instructions to you):
{{editPrompt}}
