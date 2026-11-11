// Hand-written pull request headers, trimmed from what GitHub served signed out on 2026-11-11
// (https://github.com/TanStack/router/pull/8658 and its /files tab); see docs/github-dom-notes.md.

const tabs = (base: string) =>
	['', '/commits', '/checks', '/files']
		.map((tab) => `<a class="TabNavLink__LGP-9p" href="${base}${tab}">${tab || 'Conversation'}</a>`)
		.join('')

/** The React header of the Conversation, Commits and Checks tabs. */
export const reactHeader = (base = '/o/r/pull/1', additions = '+5,792', deletions = '-5,344') => `
<header class="prc-PageLayout-Header-0of-R" data-component="SplitPageLayout.Header">
	<div class="prc-PageHeader-PageHeader-YLwBQ" data-component="PageHeader">
		<h1><bdi>A pull request</bdi> <span>#1</span></h1>
		<div class="prc-PageHeader-Navigation--uLav" data-component="PH_Navigation">
			<div class="rightContentWrapper__DE7XPN">
				<div class="d-flex flex-items-center gap-1">
					<span aria-hidden="true" class="f6 fgColor-success text-bold">${additions}</span>
					<span aria-hidden="true" class="f6 fgColor-danger text-bold">${deletions}</span>
					<span class="sr-only">Lines changed: ${additions.slice(1).replaceAll(',', '')} additions &amp; ${deletions.slice(1).replaceAll(',', '')} deletions</span>
					<div class="d-flex">
						<div data-testid="addition diffstat" class="diffSquare__kZ1s3g addition__3w3cWj"></div>
						<div data-testid="deletion diffstat" class="diffSquare__kZ1s3g deletion__wmC-SA"></div>
						<div data-testid="neutral diffstat" class="diffSquare__kZ1s3g neutral__T4nd7Z"></div>
					</div>
				</div>
			</div>
			<nav aria-label="Pull request navigation">${tabs(base)}</nav>
		</div>
	</div>
</header>`

/** The classic Files changed tab bar with its diffstat; `headSha` goes into a partial URL as the page has it. */
export const classicHeader = (base = '/o/r/pull/1', headSha = 'a'.repeat(40)) => `
<div class="tabnav">
	<nav class="tabnav-tabs">${tabs(base)}</nav>
	<div class="tabnav-extra float-right d-none d-md-block">
		<span class="diffstat" id="diffstat">
			<span class="color-fg-success">
				+5,792
			</span>
			<span class="color-fg-danger">
				−5,344
			</span>
			<span><span class="diffstat-block-added"></span><span class="diffstat-block-deleted"></span></span>
		</span>
	</div>
</div>
<div class="js-diff-progressive-container" data-url="${base}/show_partial_comparison?base_commit_oid=${'b'.repeat(40)}&amp;end_commit_oid=${headSha}&amp;start_commit_oid=${'b'.repeat(40)}"></div>`

/** A Changes page file header, which states its own lines changed. */
export const fileHeader = () => `
<div data-diff-header-wrapper="">
	<div class="d-flex flex-items-center gap-1">
		<span class="fgColor-success">+3</span><span class="fgColor-danger">-1</span>
		<span class="sr-only">Lines changed: 3 additions &amp; 1 deletion</span>
	</div>
</div>`

/** GitHub's embedded page data for a pull request with this head commit. */
export const embeddedData = (number: number, headSha: string) =>
	`<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
		payload: { pullRequestsLayoutRoute: { pullRequest: { number, headSha, state: 'OPEN' } } },
	})}</script>`
