package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	TTLChampionList = 300 * time.Second
	TTLChampion     = 300 * time.Second
)

// Client wraps a redis.Client with helper methods.
type Client struct {
	rdb *redis.Client
}

// New parses the Redis URL and returns a Client.
func New(redisURL string) (*Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis URL: %w", err)
	}
	rdb := redis.NewClient(opts)
	return &Client{rdb: rdb}, nil
}

// Ping checks the Redis connection.
func (c *Client) Ping(ctx context.Context) error {
	return c.rdb.Ping(ctx).Err()
}

// Close closes the underlying Redis connection.
func (c *Client) Close() error {
	return c.rdb.Close()
}

// GetJSON retrieves a cached value and JSON-decodes it into dst.
// Returns (false, nil) on cache miss, (true, nil) on hit, (_, err) on error.
func (c *Client) GetJSON(ctx context.Context, key string, dst interface{}) (bool, error) {
	val, err := c.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("redis GET %s: %w", key, err)
	}
	if err := json.Unmarshal(val, dst); err != nil {
		return false, fmt.Errorf("unmarshal cached %s: %w", key, err)
	}
	return true, nil
}

// SetJSON JSON-encodes src and stores it under key with a TTL.
func (c *Client) SetJSON(ctx context.Context, key string, src interface{}, ttl time.Duration) error {
	data, err := json.Marshal(src)
	if err != nil {
		return fmt.Errorf("marshal for cache %s: %w", key, err)
	}
	if err := c.rdb.Set(ctx, key, data, ttl).Err(); err != nil {
		return fmt.Errorf("redis SET %s: %w", key, err)
	}
	return nil
}

// Delete removes one or more keys.
func (c *Client) Delete(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := c.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("redis DEL: %w", err)
	}
	return nil
}

// ZAddSkin updates both lb:stars and lb:x sorted sets for a skin.
func (c *Client) ZAddSkin(ctx context.Context, skinID string, totalStars, totalX int64) error {
	pipe := c.rdb.Pipeline()
	pipe.ZAdd(ctx, "lb:stars", redis.Z{Score: float64(totalStars), Member: skinID})
	pipe.ZAdd(ctx, "lb:x", redis.Z{Score: float64(totalX), Member: skinID})
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("redis ZADD leaderboards: %w", err)
	}
	return nil
}

// ZTopN returns the top-N skin IDs (by descending score) from a sorted set.
// Returns an empty slice if the key does not exist.
func (c *Client) ZTopN(ctx context.Context, key string, n int64) ([]string, error) {
	results, err := c.rdb.ZRevRangeByScore(ctx, key, &redis.ZRangeBy{
		Min:    "-inf",
		Max:    "+inf",
		Offset: 0,
		Count:  n,
	}).Result()
	if err == redis.Nil || len(results) == 0 {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redis ZREVRANGEBYSCORE %s: %w", key, err)
	}
	return results, nil
}

// KeyChampionList is the cache key for the full champion list.
const KeyChampionList = "champions:list"

// KeyChampion returns the cache key for a single champion (lowercased id).
func KeyChampion(id string) string {
	return "champion:" + id
}
