import { animated, useSpring } from '@react-spring/web';

/* Styles */
import './right-nav.css';

/* Icons */
import PanelClose from '@assets/svg/panel-close.svg?react';
import MagnifyingGlass from '@assets/svg/magnifying-glass.svg?react';

/* Components */
import { Tooltip } from '@/components/tooltip';
import { Input } from '@/components/input';

interface RightNavProps {
	isOpen: boolean;
	onClose: () => void;
}

export function RightNav({ isOpen, onClose }: RightNavProps) {
	// Hooks
	const spring = useSpring({
		transform: isOpen ? 'translateX(0%)' : 'translateX(-120%)',
		config: isOpen
			? { tension: 288, friction: 32 }
			: { tension: 264, friction: 48, clamp: true },
	});

	return (
		<animated.nav className="right-nav" style={spring}>
			<div className="top">
				<Tooltip label="Close" shortcut="⌘B" side="bottom">
					<PanelClose
						className="close-icon"
						aria-label="Close Panel"
						onClick={onClose}
					/>
				</Tooltip>
				<Input className="right-nav-input" LeftIcon={<MagnifyingGlass />} />
			</div>
			<div className="separator" aria-hidden></div>
			<div className="bottom">HOLA</div>
		</animated.nav>
	);
}
