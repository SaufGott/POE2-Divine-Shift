System: Build a local, offline browser dashboard for PoE2 triangular arbitrage. No external servers or APIs.
Tech Stack: HTML/JS or React/Vue, Tesseract.js (client-side OCR), dark mode.

Inputs:
OCR Auto-Capture: Extract 3 exchange pairs (e.g., Div/Ex, Omen/Ex, Div/Omen) from the game screen. Include a manual entry fallback.

Mathematical Logic & Constraints:

 3-Step Loop: Calculate arbitrage net profit (e.g., C1 $\rightarrow$ C2 $\rightarrow$ Item A $\rightarrow$ C1).
 Strict Integer Quantization: Scale trades using the lowest common multiple to ensure exact whole-number transactions across all steps (e.g., scale 1 Item = 4.5 Exalts to 2 Items = 9 Exalts).

Gold Cap: Include a user-input variable for "Available Gold" to cap maximum trade volume.

UI/UX Outputs:
Live P&L: Display net profit (in C1) and ROI %. Requires OCR capture of C1/C2 ratio.
Executable Playbook: Generate step-by-step, copy-pasteable batch instructions.

Order Splitting: Split bulk sell orders into smaller batches at specific ratios (e.g., 48/Div and 49/Div) based on inventory size.