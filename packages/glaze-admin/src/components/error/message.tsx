import type { ReactNode } from 'react';

import './message.css';

/**
 * The centered message every failure state shares: a heading, an explanation, an optional technical
 * detail, and an optional action.
 *
 * @param props.title - What went wrong, in the viewer's terms.
 * @param props.body - Supporting copy.
 * @param props.detail - Raw technical text, e.g. an error message. Rendered verbatim and scrollable.
 * @param props.action - A link or button offering a way out.
 * @returns The message block.
 */
export function ErrorMessage({
	title,
	body,
	detail,
	action,
}: {
	title: string;
	body: string;
	detail?: string;
	action?: ReactNode;
}) {
	return (
		<div className="error-message">
			<h1>{title}</h1>
			<p>{body}</p>
			{detail && <pre className="error-message-detail">{detail}</pre>}
			{action}
		</div>
	);
}
