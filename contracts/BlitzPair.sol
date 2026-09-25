// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BlitzPair
/// @notice A constant-product (x * y = k) AMM pool for one pair of ERC-20 tokens.
/// The pool is itself an ERC-20: its tokens ("LP tokens") are shares of the pool.
/// @dev Supports standard ERC-20s only (no fee-on-transfer or rebasing tokens).
contract BlitzPair is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice LP tokens burned forever on the first deposit, so the pool can never be emptied.
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;

    /// @notice Swap fee in basis points (30 bps = 0.30%). It stays in the pool, paying LPs.
    uint256 public constant FEE_BPS = 30;

    uint256 private constant BPS = 10_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    /// @notice Pool balances as of the last pool action. Prices are computed from these.
    uint256 public reserve0;
    uint256 public reserve1;

    event LiquidityAdded(
        address indexed provider, address indexed to, uint256 amount0, uint256 amount1, uint256 liquidity
    );
    event LiquidityRemoved(
        address indexed provider, address indexed to, uint256 amount0, uint256 amount1, uint256 liquidity
    );
    event Swap(
        address indexed sender, address indexed to, address indexed tokenIn, uint256 amountIn, uint256 amountOut
    );
    event Sync(uint256 reserve0, uint256 reserve1);

    error IdenticalTokens();
    error ZeroAddress();
    error Expired();
    error InvalidToken();
    error InsufficientInputAmount();
    error InsufficientOutputAmount();
    error InsufficientLiquidity();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error SlippageExceeded(uint256 actual, uint256 minimum);

    /// @dev Rejects transactions that sat in the mempool too long, when prices may have moved.
    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(IERC20 tokenA, IERC20 tokenB) ERC20("BlitzSwap LP", "BLP") {
        if (address(tokenA) == address(tokenB)) revert IdenticalTokens();
        if (address(tokenA) == address(0) || address(tokenB) == address(0)) revert ZeroAddress();
        token0 = tokenA;
        token1 = tokenB;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    /// @notice How many tokens a swap of `amountIn` of `tokenIn` would return right now.
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        if (tokenIn == address(token0)) return _getAmountOut(amountIn, reserve0, reserve1);
        if (tokenIn == address(token1)) return _getAmountOut(amountIn, reserve1, reserve0);
        revert InvalidToken();
    }

    // ---------------------------------------------------------------------
    // Liquidity
    // ---------------------------------------------------------------------

    /// @notice Deposit both tokens and receive LP tokens.
    /// @dev After the first deposit, amounts are trimmed to match the current pool ratio;
    /// only the trimmed amounts are pulled from the caller.
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        (amount0, amount1) = _optimalAmounts(amount0Desired, amount1Desired);
        if (amount0 < amount0Min) revert SlippageExceeded(amount0, amount0Min);
        if (amount1 < amount1Min) revert SlippageExceeded(amount1, amount1Min);

        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1);
            if (liquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidityMinted();
            liquidity -= MINIMUM_LIQUIDITY;
            _mint(DEAD, MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min(amount0 * supply / reserve0, amount1 * supply / reserve1);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();

        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        _mint(to, liquidity);
        _sync();

        emit LiquidityAdded(msg.sender, to, amount0, amount1, liquidity);
    }

    /// @notice Burn LP tokens and receive your share of both tokens, including earned fees.
    function removeLiquidity(uint256 liquidity, uint256 amount0Min, uint256 amount1Min, address to, uint256 deadline)
        external
        nonReentrant
        ensure(deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        uint256 supply = totalSupply();
        if (supply == 0) revert InsufficientLiquidity();

        amount0 = liquidity * reserve0 / supply;
        amount1 = liquidity * reserve1 / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();
        if (amount0 < amount0Min) revert SlippageExceeded(amount0, amount0Min);
        if (amount1 < amount1Min) revert SlippageExceeded(amount1, amount1Min);

        _burn(msg.sender, liquidity);
        token0.safeTransfer(to, amount0);
        token1.safeTransfer(to, amount1);
        _sync();

        emit LiquidityRemoved(msg.sender, to, amount0, amount1, liquidity);
    }

    // ---------------------------------------------------------------------
    // Swapping
    // ---------------------------------------------------------------------

    /// @notice Sell exactly `amountIn` of `tokenIn` for at least `amountOutMin` of the other token.
    function swap(address tokenIn, uint256 amountIn, uint256 amountOutMin, address to, uint256 deadline)
        external
        nonReentrant
        ensure(deadline)
        returns (uint256 amountOut)
    {
        IERC20 inToken;
        IERC20 outToken;
        uint256 reserveIn;
        uint256 reserveOut;
        if (tokenIn == address(token0)) {
            (inToken, outToken, reserveIn, reserveOut) = (token0, token1, reserve0, reserve1);
        } else if (tokenIn == address(token1)) {
            (inToken, outToken, reserveIn, reserveOut) = (token1, token0, reserve1, reserve0);
        } else {
            revert InvalidToken();
        }

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
        if (amountOut == 0) revert InsufficientOutputAmount();
        if (amountOut < amountOutMin) revert SlippageExceeded(amountOut, amountOutMin);

        inToken.safeTransferFrom(msg.sender, address(this), amountIn);
        outToken.safeTransfer(to, amountOut);
        _sync();

        emit Swap(msg.sender, to, tokenIn, amountIn, amountOut);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Constant-product pricing with the fee taken from the input:
    ///   (reserveIn + amountInAfterFee) * (reserveOut - amountOut) = reserveIn * reserveOut
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) private pure returns (uint256) {
        if (amountIn == 0) revert InsufficientInputAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * (BPS - FEE_BPS);
        return amountInWithFee * reserveOut / (reserveIn * BPS + amountInWithFee);
    }

    /// @dev Largest deposit within the desired amounts that keeps the pool's current ratio.
    function _optimalAmounts(uint256 amount0Desired, uint256 amount1Desired) private view returns (uint256, uint256) {
        if (reserve0 == 0 && reserve1 == 0) return (amount0Desired, amount1Desired);

        uint256 amount1Optimal = amount0Desired * reserve1 / reserve0;
        if (amount1Optimal <= amount1Desired) return (amount0Desired, amount1Optimal);

        uint256 amount0Optimal = amount1Desired * reserve0 / reserve1;
        return (amount0Optimal, amount1Desired);
    }

    function _sync() private {
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
        emit Sync(reserve0, reserve1);
    }
}
