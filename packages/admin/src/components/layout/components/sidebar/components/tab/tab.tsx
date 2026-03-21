import { animated, useSpring } from '@react-spring/web';
import PanelOpenIcon from '@assets/svg/panel-open.svg?react';

import { Tooltip } from '@/components/tooltip';
import './tab.css';

interface TabProps {
	isOpen: boolean;
	onOpen: () => void;
}

export function DashboardLayoutSidebarTab({ isOpen, onOpen }: TabProps) {
	const spring = useSpring({
		transform: isOpen ? 'translateX(-200%)' : 'translateX(0%)',
		delay: isOpen ? 0 : 232,
		config: isOpen
			? { tension: 300, friction: 24 }
			: { tension: 200, friction: 24 },
	});

	return (
		<Tooltip label="Toggle" shortcut="⌘B" disabled={isOpen}>
			<animated.div
				className="dashboard-layout-sidebar-tab flex-col flex-center"
				style={spring}
				onClick={isOpen ? undefined : onOpen}
			>
				<PanelOpenIcon />
			</animated.div>
		</Tooltip>
	);
}
