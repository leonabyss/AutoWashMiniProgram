**Comparison Target**

- Source visual truth: `C:\Users\Leon\.codex\generated_images\019e79a6-2f8a-7f43-ab66-47572ea8e526\call_ogxGn8nmtdiwroColC3I2BMF.png`
- Rendered implementation: `C:\Users\Leon\AppData\Local\Temp\wx-sim-new-fixed.png`
- Combined comparison: `C:\Users\Leon\AppData\Local\Temp\autowash-home-design-qa-comparison.png`
- Responsive evidence: `C:\Users\Leon\AppData\Local\Temp\wx-small-new.png`
- Source pixels: 853 x 1856.
- Implementation capture pixels: 540 x 1200.
- CSS viewport: Huawei Mate 80, 366 x 809; small-device check, 375 x 667.
- Density normalization: source downsampled to 552 x 1200 and implementation retained at 540 x 1200 for a same-height side-by-side comparison.
- State: logged-in cached profile with live CMS banner, wallet/card summary, last-use machine state, and no resumable order.

**Findings**

- No actionable P0, P1, or P2 findings remain.
- The native navigation bar replaces the mock's in-content brand header. This is intentional because the new screen is currently a secondary preview route and follows the project's native-navigation requirement.
- The native tab bar is absent on the preview route. This is expected: WeChat only renders the native tab bar on configured tab pages, while the existing home tab remains unchanged.
- Banner art, account value, last-use content, badge artwork, and the `¥150` promotion reflect live CMS/API data and existing business behavior rather than the mock's sample content.

**Required Fidelity Surfaces**

- Fonts and typography: native Chinese system type remains readable, weights preserve the mock hierarchy, and compact labels do not wrap at 366 x 809 or 375 x 667.
- Spacing and layout rhythm: account summary, CMS banner, scan action, secondary actions, and last-use row remain aligned and fit without scrolling on both tested devices.
- Colors and visual tokens: white/cool-gray surfaces, cobalt primary action, green machine state, and coral promotion badge match the selected direction and retain outdoor contrast.
- Image quality and asset fidelity: the banner and franchise badge use live CMS raster assets without stretching; action icons use Lucide library SVG assets.
- Copy and content: scan, share, buy-card, resume, last-use, account, CMS, and phone-auth copy are connected to the same controller and API behavior as the existing home page.

**Comparison History**

- Earlier P2: the primary scan button rendered at about half the available width.
- Fix: added an explicit full-width operation container and `width/min-width: 100% !important` to `.scan-action`.
- Post-fix evidence: `C:\Users\Leon\AppData\Local\Temp\wx-sim-new-fixed.png`; the scan action now spans the content width and remains aligned on the 375 x 667 responsive check.

**Interaction Checks**

- Existing home `体验新版首页` entry opens `/pages/home-new/home-new`.
- Native back returns to the existing home page.
- New-home `购买洗车卡` opens the existing buy-card page.
- CMS banner and account/last-machine data render from the existing shared API controller.
- Console errors inspected: current errors are existing HTTP 401 responses from the expired local login session plus a simulator timeout; no new compile or page-script error was observed.

**Follow-up Polish**

- P3: when the backend supplies a new franchise badge asset, prefer a flatter horizontal image that matches the narrow right-edge treatment in the selected mock.

final result: passed
