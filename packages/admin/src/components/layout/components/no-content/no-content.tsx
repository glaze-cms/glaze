import classNames from 'classnames';

/* Types */
import type { PropsWithChildren, ReactNode } from 'react';

/* Styles */
import './no-content.css';

interface NoContentProps extends PropsWithChildren {
	title: string;
	CTA?: ReactNode;
	withBorder?: boolean;
}

export function NoContent({
	title,
	children,
	CTA = null,
	withBorder = false,
}: NoContentProps) {
	return (
		<article
			className={classNames('no-content', { 'with-border': withBorder })}
		>
			<h3 className="title">{title}</h3>
			<div className="body">{children}</div>
			{CTA}
		</article>
	);
}
