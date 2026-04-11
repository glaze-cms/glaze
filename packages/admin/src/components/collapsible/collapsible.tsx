import { Collapsible as BaseCollapsible } from '@base-ui/react';
import classNames from 'classnames';

/* Icons */
import ChevronIcon from '@assets/svg/chevron.svg?react';

/* Styles */
import './collapsible.css';

/* Types */
import type { CSSProperties, ReactNode } from 'react';
import type { WithClassName } from '@/types';

interface CollapsibleProps extends WithClassName {
	trigger: {
		Icon: ReactNode;
		title: string;
		className?: string;
	};
	panel: {
		className?: string;
		elements: {
			label: string;
			isActive?: boolean;
			onClick: () => void;
		}[];
	};
}

export function Collapsible({
	className,
	trigger: { Icon, title, className: triggerClassName },
	panel: { className: panelClassName, elements },
}: CollapsibleProps) {
	return (
		<BaseCollapsible.Root className={classNames('collapsible', className)}>
			<BaseCollapsible.Trigger
				className={classNames('trigger', triggerClassName)}
			>
				{Icon}
				<span className="title">{title}</span>
				<ChevronIcon className="chevron" />
			</BaseCollapsible.Trigger>
			<BaseCollapsible.Panel
				keepMounted
				className={classNames('panel', panelClassName)}
			>
				{elements.map((element, index) => (
					<button
						key={index}
						style={{ '--i': index } as CSSProperties}
						onClick={element.onClick}
						className={classNames('element', { active: element.isActive })}
					>
						{element.label}
					</button>
				))}
			</BaseCollapsible.Panel>
		</BaseCollapsible.Root>
	);
}
