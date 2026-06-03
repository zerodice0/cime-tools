# CI.ME Live Discord

CI.ME 본인 채널의 라이브 시작을 감지해서 Discord 채널 하나로 알림을 보내는 작은 대시보드입니다.

## 동작 정책

- 사용자는 Clerk로 로그인합니다.
- CI.ME OAuth 연동으로 확인된 본인 채널만 저장합니다.
- CI.ME access token과 refresh token은 채널 확인 직후 revoke하고 저장하지 않습니다.
- Discord 연결은 incoming webhook 하나만 저장합니다.
- 첫 확인에서 이미 라이브인 경우에는 기준값만 저장하고 알림을 보내지 않습니다.
- `OFF -> ON` 또는 새 `openedAt` 감지 시 Discord 알림을 한 번 보내고 다음 확인을 1시간 뒤로 미룹니다.
- 오프라인 상태는 기본 5분 간격으로 확인합니다.
- 모니터링 기준 30일 이상 오프라인이면 Discord에 한 번 고지하고 `stalePaused`로 정지합니다.
- 정지된 모니터는 사용자가 대시보드에서 `다시 요청`을 누르기 전까지 Discord 메시지를 보내지 않습니다.

## 준비

```bash
npm install
```

Clerk에서 Convex JWT 템플릿 이름을 `convex`로 활성화합니다.

CI.ME 개발자 포털에서 애플리케이션을 만들고 Redirect URI를 등록합니다.

로컬 예시:

```text
http://localhost:5173/cime/callback
```

## 환경 변수

프론트엔드 `.env.local`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
VITE_CONVEX_URL=https://replace-me.convex.cloud
```

Convex 환경 변수:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://replace-me.clerk.accounts.dev
npx convex env set CIME_CLIENT_ID replace_me
npx convex env set CIME_CLIENT_SECRET replace_me
npx convex env set CIME_REDIRECT_URI http://localhost:5173/cime/callback
npx convex env set POLL_BATCH_SIZE 25
```

## 실행

Convex 함수와 `_generated` 타입을 생성합니다.

```bash
npx convex dev
```

다른 터미널에서 Vite를 실행합니다.

```bash
npm run dev
```

## Cloudflare Pages 운영

이 앱은 Cloudflare Pages의 기본 도메인인 `https://cime-tools.pages.dev`에서 개인용 기능 동작 데모로 운영할 수 있습니다.
현재 hobby demo 운영은 Clerk development instance를 사용합니다. 사용자 1명 또는 소수 테스트에는 충분하지만, 공개 서비스나 수익화 단계에서는 소유 도메인을 연결하고 Clerk production instance로 전환해야 합니다.

Cloudflare CLI로 프로젝트를 만들고 직접 업로드 배포할 수 있습니다.

```bash
npm run cf:login
npm run cf:whoami
npm run pages:create
```

직접 업로드 배포는 로컬에서 빌드한 `dist`를 Cloudflare Pages에 올립니다.
이 방식에서는 Vite 환경 변수가 Cloudflare가 아니라 로컬 빌드 시점에 필요합니다.
hobby demo 값은 `.env.production.local`에 둡니다.

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
VITE_CONVEX_URL=https://marvelous-mammoth-404.convex.cloud
```

```bash
npm run deploy:pages
```

Cloudflare Pages의 Git 연동을 사용한다면 같은 설정을 Dashboard에 입력합니다.

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Production URL: https://cime-tools.pages.dev
```

Convex production 배포와 hobby demo 환경 변수:

```bash
npm run deploy:convex
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://replace-me.clerk.accounts.dev
npx convex env set CIME_CLIENT_ID replace_me
npx convex env set CIME_CLIENT_SECRET replace_me
npx convex env set CIME_REDIRECT_URI https://cime-tools.pages.dev/cime/callback
npx convex env set POLL_BATCH_SIZE 25
```

외부 콘솔에서 등록할 URL:

- Clerk development instance에 `https://cime-tools.pages.dev`와 `https://cime-tools.pages.dev/sso-callback`을 허용합니다.
- CI.ME 개발자 포털 Redirect URI는 `https://cime-tools.pages.dev/cime/callback`입니다.

`public/_redirects`는 `/sso-callback`과 `/cime/callback` 같은 클라이언트 경로가 새로고침이나 OAuth 콜백에서도 `index.html`로 열리도록 합니다.

Clerk development instance는 100 user 제한, development 표시, production과 다른 세션 구조를 가집니다. 수익화나 공개 운영으로 전환할 때는 저렴한 소유 도메인을 구매한 뒤 Clerk production domain, Google OAuth production credential, Convex `CLERK_JWT_ISSUER_DOMAIN`을 함께 교체합니다.

## Discord 연결

Discord 채널 설정에서 webhook을 만든 뒤 URL을 대시보드에 저장합니다. 이 앱은 Discord bot token을 저장하지 않고 webhook URL만 사용합니다.

## CI.ME API 사용 지점

- OAuth 시작: `https://ci.me/auth/openapi/account-interlock`
- 토큰 교환: `POST https://ci.me/api/openapi/auth/v1/token`
- 본인 채널 확인: `GET https://ci.me/api/openapi/open/v1/users/me`
- 라이브 상태 확인: `GET https://ci.me/api/openapi/v1/{channelId}/live-status`
